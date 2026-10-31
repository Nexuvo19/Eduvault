import json
import os
import unittest
from unittest.mock import MagicMock, patch

import app


def valid_questions(count=5):
    return [
        {"q": f"Question {index}?", "opts": ["A", "B", "C", "D"], "ans": 0, "topic": "Basics"}
        for index in range(count)
    ]


class AITestValidation(unittest.TestCase):
    def test_valid_generated_test_has_database_ready_shape(self):
        test = app.validate_generated_test(
            {"title": "Basics quiz", "questions": valid_questions()},
            subject_id="subject-1",
            topic="Basics",
            difficulty="easy",
            question_count=5,
        )
        self.assertEqual(test["subject"], "subject-1")
        self.assertEqual(test["duration"], 600)
        self.assertEqual(len(test["questions"]), 5)

    def test_wrong_question_count_is_rejected(self):
        with self.assertRaises(app.AIServiceError):
            app.validate_generated_test(
                {"title": "Basics quiz", "questions": valid_questions(4)},
                subject_id="subject-1",
                topic="Basics",
                difficulty="easy",
                question_count=5,
            )

    def test_invalid_answer_index_is_rejected(self):
        questions = valid_questions()
        questions[0]["ans"] = 4
        with self.assertRaises(app.AIServiceError):
            app.validate_generated_test(
                {"title": "Basics quiz", "questions": questions},
                subject_id="subject-1",
                topic="Basics",
                difficulty="easy",
                question_count=5,
            )


class ResourceLinkTests(unittest.TestCase):
    def test_resource_links_require_https_and_a_host(self):
        self.assertEqual(
            app.validate_resource_url("https://openstax.org/details/books/calculus-volume-1"),
            "https://openstax.org/details/books/calculus-volume-1",
        )
        self.assertIsNone(app.validate_resource_url(""))
        for value in ("http://openstax.org", "javascript:alert(1)", "https://user@example.com"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                app.validate_resource_url(value)

    def test_bootstrap_resource_includes_external_source_link(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{
            "id": "oer-calculus",
            "title": "Open calculus",
            "subject_id": "sub2",
            "semester": "sem1",
            "category": "Reference Materials",
            "format": "LINK",
            "resource_date": "2026-10-31",
            "uploader": "OpenStax",
            "branch": "Computer Science",
            "study_year": "1",
            "file_id": None,
            "external_url": "https://openstax.org/details/books/calculus-volume-1",
            "original_name": None,
            "content_type": None,
        }]

        resources = app.fetch_resources(cursor)

        self.assertEqual(resources[0]["externalUrl"], "https://openstax.org/details/books/calculus-volume-1")
        self.assertEqual(resources[0]["uploader"], "OpenStax")

    def test_faculty_cannot_save_unsafe_resource_link(self):
        app.app.config["TESTING"] = True
        client = app.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
            session["role"] = "faculty"
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchall.return_value = [("sub1", "sem1", "Computer Science", "1")]

        with patch.object(app, "db_connect", return_value=connection):
            response = client.put("/api/admin/resources", json=[{
                "id": "resource-1",
                "title": "Unsafe link",
                "subject": "sub1",
                "externalUrl": "javascript:alert(1)",
            }])

        self.assertEqual(response.status_code, 400)
        connection.rollback.assert_called_once()
        self.assertEqual(
            [call for call in cursor.execute.call_args_list if "INSERT INTO resources" in call.args[0]],
            [],
        )

    def test_faculty_can_save_a_publisher_link(self):
        app.app.config["TESTING"] = True
        client = app.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = "test-user"
            session["role"] = "faculty"
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchall.return_value = [("sub1", "sem1", "Computer Science", "1")]

        with patch.object(app, "db_connect", return_value=connection):
            response = client.put("/api/admin/resources", json=[{
                "id": "resource-1",
                "title": "Open textbook",
                "subject": "sub1",
                "category": "Reference Materials",
                "format": "LINK",
                "uploader": "OpenStax",
                "externalUrl": "https://openstax.org/details/books/calculus-volume-1",
            }])

        self.assertEqual(response.status_code, 200)
        insert = next(
            call for call in cursor.execute.call_args_list
            if "INSERT INTO resources" in call.args[0]
        )
        self.assertEqual(insert.args[1][7], "OpenStax")
        self.assertEqual(insert.args[1][-1], "https://openstax.org/details/books/calculus-volume-1")
        connection.commit.assert_called_once()


class AIEndpointTests(unittest.TestCase):
    def setUp(self):
        app.app.config["TESTING"] = True
        self.client = app.app.test_client()

    def sign_in_as(self, role):
        with self.client.session_transaction() as session:
            session["user_id"] = "test-user"
            session["role"] = role

    def test_agent_requires_authentication(self):
        response = self.client.post("/api/ai/agent", json={"action": "chat", "message": "Help"})
        self.assertEqual(response.status_code, 401)

    def test_student_cannot_generate_shared_test_drafts(self):
        self.sign_in_as("student")
        response = self.client.post("/api/ai/agent", json={
            "action": "generate_test",
            "subjectId": "subject-1",
            "topic": "Basics",
            "difficulty": "easy",
            "questionCount": 5,
        })
        self.assertEqual(response.status_code, 403)

    def test_missing_provider_key_is_reported_without_database_access(self):
        self.sign_in_as("student")
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), patch.object(app, "db_connect") as db_connect:
            response = self.client.post("/api/ai/agent", json={"action": "chat", "message": "Help"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("GEMINI_API_KEY", response.get_json()["error"])
        db_connect.assert_not_called()

    def test_chat_returns_ai_answer_and_course_sources(self):
        self.sign_in_as("student")
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = {"id": "subject-1", "name": "Computer Science"}
        cursor.fetchall.return_value = []
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), patch.object(
            app, "db_connect", return_value=connection
        ), patch.object(app, "call_gemini", return_value="A helpful answer."):
            response = self.client.post("/api/ai/agent", json={
                "action": "chat",
                "message": "Explain this topic",
                "subjectId": "subject-1",
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {
            "reply": "A helpful answer.",
            "sources": [],
        })
        connection.close.assert_called_once()

    def test_faculty_can_generate_a_valid_unsaved_draft(self):
        self.sign_in_as("faculty")
        connection = MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchone.return_value = {"id": "subject-1", "name": "Computer Science"}
        cursor.fetchall.return_value = []
        generated = json.dumps({"title": "Computer Science Basics", "questions": valid_questions()})
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), patch.object(
            app, "db_connect", return_value=connection
        ), patch.object(app, "call_gemini", return_value=generated):
            response = self.client.post("/api/ai/agent", json={
                "action": "generate_test",
                "subjectId": "subject-1",
                "topic": "Basics",
                "difficulty": "easy",
                "questionCount": 5,
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["test"]["title"], "Computer Science Basics")
        self.assertEqual(len(response.get_json()["test"]["questions"]), 5)
        connection.commit.assert_not_called()
        connection.close.assert_called_once()

    def test_gemini_response_is_parsed(self):
        fake_response = MagicMock()
        fake_response.__enter__.return_value.read.return_value = json.dumps({
            "candidates": [{"content": {"parts": [{"text": "Hello"}]}}],
        }).encode()
        with patch.dict(os.environ, {"GEMINI_API_KEY": "test-key"}), patch.object(
            app, "urlopen", return_value=fake_response
        ) as urlopen:
            result = app.call_gemini("Prompt", system_instruction="Study helper")
        self.assertEqual(result, "Hello")
        self.assertIn("gemini-2.5-flash", urlopen.call_args.args[0].full_url)
        self.assertNotIn("test-key", urlopen.call_args.args[0].full_url)
        self.assertEqual(urlopen.call_args.args[0].get_header("X-goog-api-key"), "test-key")


if __name__ == "__main__":
    unittest.main()
