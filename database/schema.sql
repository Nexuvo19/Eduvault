-- EduVault MySQL schema. Run this after: CREATE DATABASE eduvault CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; USE eduvault;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  identifier VARCHAR(190) NOT NULL UNIQUE,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student','faculty') NOT NULL DEFAULT 'student',
  branch VARCHAR(100) NULL,
  semester VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documents (
  id CHAR(32) NOT NULL PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  extension VARCHAR(12) NOT NULL,
  content_type VARCHAR(150) NOT NULL,
  original_size BIGINT UNSIGNED NOT NULL,
  pdf_size BIGINT UNSIGNED NOT NULL,
  original_data LONGBLOB NULL,
  pdf_data LONGBLOB NULL,
  owner_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_documents_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(40) NOT NULL,
  semester VARCHAR(20) NOT NULL,
  branch VARCHAR(100) NOT NULL,
  study_year VARCHAR(10) NOT NULL DEFAULT '1',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subjects_branch_semester (branch, semester)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS resources (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject_id VARCHAR(32) NOT NULL,
  semester VARCHAR(20) NOT NULL DEFAULT 'sem1',
  category VARCHAR(80) NOT NULL,
  format VARCHAR(20) NOT NULL,
  resource_date DATE NOT NULL,
  uploader VARCHAR(150) NOT NULL DEFAULT 'Academic Resources Team',
  branch VARCHAR(100) NOT NULL DEFAULT 'Computer Science',
  study_year VARCHAR(10) NOT NULL DEFAULT '1',
  file_id CHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_resources_subject (subject_id),
  INDEX idx_resources_category (category),
  CONSTRAINT fk_resources_document FOREIGN KEY (file_id) REFERENCES documents(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignments (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject_id VARCHAR(32) NOT NULL,
  description TEXT NOT NULL,
  assigned_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_assignments_due (due_date),
  CONSTRAINT fk_assignments_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practice_tests (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  subject_id VARCHAR(32) NOT NULL,
  topic VARCHAR(150) NOT NULL,
  duration_seconds INT UNSIGNED NOT NULL,
  difficulty VARCHAR(20) NOT NULL,
  questions JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_practice_tests_subject (subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  department VARCHAR(150) NOT NULL DEFAULT 'Academic Office',
  announcement_date DATE NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
  description TEXT NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_announcements_date (announcement_date),
  CONSTRAINT fk_announcements_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_workspace_data (
  user_id BIGINT UNSIGNED NOT NULL,
  data_key VARCHAR(50) NOT NULL,
  data_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, data_key),
  CONSTRAINT fk_workspace_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO subjects (id,name,code,semester,branch,study_year) VALUES
('sub1','Programming in C','CS101','sem1','Computer Science','1'),
('sub2','Mathematics-I','MA101','sem1','Computer Science','1'),
('sub3','Physics','PH101','sem1','Electronics','1'),
('sub4','Basic Electrical','EE101','sem1','Electronics','1'),
('sub5','Communication Skills','HU101','sem1','Computer Science','1'),
('sub6','Data Structures','CS201','sem2','Computer Science','1'),
('sub7','Mathematics-II','MA201','sem2','Computer Science','1');

-- Demo academic records. Remove or edit these rows after importing your own material.
INSERT IGNORE INTO resources (id,title,subject_id,semester,category,format,resource_date,uploader,branch,study_year) VALUES
('1','Introduction to C Programming — Unit 1 Notes','sub1','sem1','Notes','PDF','2026-08-12','Academic Resources Team','Computer Science','1'),
('2','Arrays and Pointers — Complete Notes','sub1','sem1','Notes','PDF','2026-09-02','Academic Resources Team','Computer Science','1'),
('3','C Programming — Model Question Paper Set 1','sub1','sem1','Model Papers','DOCX','2026-09-15','Academic Resources Team','Computer Science','1'),
('4','C Programming — Previous Year Paper 2023','sub1','sem1','Previous Papers','PDF','2026-01-10','Academic Resources Team','Computer Science','1'),
('5','Lab 01: Hello World & Variable Scope','sub1','sem1','Laboratory Programs','LAB','2026-08-20','Academic Resources Team','Computer Science','1'),
('6','Lab 02: Functions and Recursion','sub1','sem1','Laboratory Programs','LAB','2026-08-27','Academic Resources Team','Computer Science','1'),
('7','Lab 03: Arrays and Strings','sub1','sem1','Laboratory Programs','LAB','2026-09-03','Academic Resources Team','Computer Science','1'),
('8','Differential Calculus — Notes','sub2','sem1','Notes','PDF','2026-08-14','Academic Resources Team','Computer Science','1'),
('9','Mathematics-I Model Paper','sub2','sem1','Model Papers','DOCX','2026-09-18','Academic Resources Team','Computer Science','1'),
('10','Mathematics-I Previous Paper 2022','sub2','sem1','Previous Papers','PDF','2026-01-08','Academic Resources Team','Computer Science','1'),
('11','Optics & Wave Optics — Reference Material','sub3','sem1','Reference Materials','PDF','2026-08-22','Academic Resources Team','Electronics','1'),
('12','Physics Lab 01: Oscilloscope Basics','sub3','sem1','Laboratory Programs','LAB','2026-08-25','Academic Resources Team','Electronics','1'),
('13','Ohm''s Law & Kirchhoff''s Laws — Notes','sub4','sem1','Notes','PDF','2026-08-30','Academic Resources Team','Electronics','1'),
('14','Effective Communication — Reference Guide','sub5','sem1','Reference Materials','PPTX','2026-09-05','Academic Resources Team','Computer Science','1'),
('15','Data Structures — Arrays & Linked Lists','sub6','sem2','Notes','PDF','2026-10-02','Academic Resources Team','Computer Science','1'),
('16','Stacks & Queues — Lab Program','sub6','sem2','Laboratory Programs','LAB','2026-10-12','Academic Resources Team','Computer Science','1');

INSERT IGNORE INTO assignments (id,title,subject_id,description,assigned_date,due_date,status,priority) VALUES
('1','Write a C program to implement a calculator','sub1','Create a menu-driven calculator supporting addition, subtraction, multiplication and division using functions.','2026-10-15','2026-11-05','Pending','high'),
('2','Solve Differential Calculus problem set','sub2','Complete problems 1–12 from Chapter 3 on limits and derivatives.','2026-10-18','2026-11-02','Pending','high'),
('3','Lab report: Oscilloscope measurements','sub3','Document observations from Lab 01 with circuit diagrams and readings.','2026-10-20','2026-11-08','Pending','medium'),
('4','Communication Skills presentation','sub5','Prepare a 5-minute presentation on a technical topic of your choice.','2026-10-18','2026-11-10','Pending','medium'),
('5','Ohm''s Law numerical worksheet','sub4','Solve the 10 numericals provided in the reference material.','2026-10-20','2026-11-12','Pending','low'),
('6','Linked List implementation','sub6','Implement singly and doubly linked lists with insertion and deletion.','2026-10-22','2026-11-15','Pending','medium');

INSERT IGNORE INTO practice_tests (id,title,subject_id,topic,duration_seconds,difficulty,questions) VALUES
('1','C Programming Basics','sub1','C Fundamentals',300,'easy','[{"q":"Which header file is required for printf()?","opts":["<stdlib.h>","<stdio.h>","<string.h>","<conio.h>"],"ans":1,"topic":"Headers"},{"q":"What is the size of int in a typical 32-bit system?","opts":["2 bytes","4 bytes","8 bytes","1 byte"],"ans":1,"topic":"Data Types"},{"q":"Which operator is used for address of a variable?","opts":["*","&","->","."],"ans":1,"topic":"Pointers"},{"q":"Which loop executes at least once?","opts":["for","while","do-while","if"],"ans":2,"topic":"Loops"},{"q":"What does %d format specifier print?","opts":["float","string","integer","char"],"ans":2,"topic":"I/O"}]'),
('2','Mathematics-I: Calculus','sub2','Differential Calculus',360,'medium','[{"q":"Derivative of sin(x) is?","opts":["cos(x)","-cos(x)","-sin(x)","tan(x)"],"ans":0,"topic":"Trigonometric"},{"q":"d/dx(x^n) equals?","opts":["nx^(n-1)","x^(n-1)","n*x^n","n!"],"ans":0,"topic":"Power Rule"},{"q":"Limit of (sin x)/x as x approaches 0 is?","opts":["0","1","infinity","undefined"],"ans":1,"topic":"Limits"},{"q":"Derivative of e^x is?","opts":["x*e^x","e^x","1","x"],"ans":1,"topic":"Exponential"},{"q":"d/dx(ln x) equals?","opts":["1/x","x","ln x","e^x"],"ans":0,"topic":"Logarithmic"}]'),
('3','Data Structures Fundamentals','sub6','Arrays & Lists',300,'medium','[{"q":"Time complexity of array access by index?","opts":["O(n)","O(1)","O(log n)","O(n^2)"],"ans":1,"topic":"Arrays"},{"q":"A linked list node contains?","opts":["data only","pointer only","data and pointer","none"],"ans":2,"topic":"Linked Lists"},{"q":"Stack follows which principle?","opts":["FIFO","LIFO","Random","Priority"],"ans":1,"topic":"Stacks"},{"q":"Queue follows which principle?","opts":["FIFO","LIFO","Random","Priority"],"ans":0,"topic":"Queues"},{"q":"Insertion at head of singly linked list is?","opts":["O(n)","O(1)","O(log n)","O(n^2)"],"ans":1,"topic":"Linked Lists"}]');

INSERT IGNORE INTO announcements (id,title,department,announcement_date,priority,description) VALUES
('1','Mid-Semester Examinations Schedule Released','Examination Cell','2026-10-28','Important','The mid-semester examinations will commence from November 18. Please check the detailed timetable on the notice board.'),
('2','C Programming Lab rescheduled','Computer Science Department','2026-10-26','Normal','The Friday lab session is moved to Saturday 10 AM due to a faculty workshop.'),
('3','Library extended hours during exam weeks','Library Services','2026-10-24','Normal','The library will remain open until 9 PM from November 1 to November 20.'),
('4','Industry guest lecture on Data Structures','Placement Cell','2026-10-22','Important','A guest lecture on real-world data structures usage is scheduled for this month.'),
('5','Assignment submission portal maintenance','IT Services','2026-10-20','Normal','The submission portal will be unavailable on Sunday 2–4 AM for scheduled maintenance.');
