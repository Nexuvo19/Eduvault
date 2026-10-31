(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const loginForm = $('#loginForm');
  const storyPanel = $('#storyPanel');
  const scene = $('#heroScene');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let selectedRole = 'student';
  let authMode = 'login';

  $('#yearNow').textContent = new Date().getFullYear();

  // A valid server session should go straight to the workspace.
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(response => { if (response.ok) window.location.replace('dashboard.html'); })
    .catch(error => console.warn('Could not check the current EduVault session.', error));

  $$('.role-choice').forEach(button => button.addEventListener('click', () => {
    selectedRole = button.dataset.role;
    $$('.role-choice').forEach(choice => {
      const active = choice === button;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    if (selectedRole === 'faculty' && authMode === 'register') setAuthMode('login');
    $('#authModeToggle').hidden = selectedRole === 'faculty';
  }));

  function showMessage(message, isError = false) {
    const target = $('#loginMessage');
    target.textContent = message;
    target.classList.toggle('is-error', isError);
    target.classList.add('is-visible');
  }

  function setAuthMode(mode) {
    authMode = mode;
    const registering = mode === 'register';
    $('#registerNameField').hidden = !registering;
    $('#confirmPasswordField').hidden = !registering;
    $('#rememberRow').hidden = registering;
    $('#forgotPassword').hidden = registering;
    $('#registerName').required = registering;
    $('#confirmPassword').required = registering;
    $('#loginPassword').autocomplete = registering ? 'new-password' : 'current-password';
    $('#authSubmitLabel').textContent = registering ? 'Create student account' : 'Sign in to EduVault';
    $('#authModeToggle').textContent = registering ? 'Already have an account? Sign in' : 'New to EduVault? Create a student account';
    $('#authTitle').innerHTML = registering ? 'Start your journey<br /><span>with EduVault.</span>' : 'Your next chapter<br /><span>starts here.</span>';
    $('#authDescription').textContent = registering ? 'Create your student account to access your academic workspace.' : 'Sign in to access your learning workspace.';
    $('#loginMessage').classList.remove('is-visible', 'is-error');
  }

  $('#authModeToggle').addEventListener('click', () => {
    if (selectedRole !== 'student') return;
    setAuthMode(authMode === 'login' ? 'register' : 'login');
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const identifier = $('#loginId').value.trim();
    const password = $('#loginPassword').value;
    if (!identifier) {
      showMessage('Enter your ID or email address to continue.', true);
      $('#loginId').focus();
      return;
    }
    if (password.length < 8) {
      showMessage('Enter a password containing at least 8 characters.', true);
      $('#loginPassword').focus();
      return;
    }
    const submit = $('.auth-submit', loginForm);
    submit.disabled = true;
    try {
      const registering = authMode === 'register';
      const payload = registering
        ? { fullName: $('#registerName').value.trim(), identifier, password }
        : { identifier, password, role: selectedRole, remember: $('#rememberMe').checked };
      if (registering) {
        if (payload.fullName.length < 2) throw new Error('Enter your full name.');
        if (password !== $('#confirmPassword').value) throw new Error('The passwords do not match.');
      }
      const response = await fetch(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      let result = {};
      try { result = await response.json(); } catch (_) { /* handled below */ }
      if (!response.ok) throw new Error(result.error || 'EduVault could not complete the request.');
      showMessage(registering ? 'Account created. Opening your workspace…' : 'Signed in. Opening your workspace…');
      window.location.assign('dashboard.html');
    } catch (error) {
      showMessage(error.message || 'Could not connect to EduVault. Start the Flask server and try again.', true);
    } finally {
      submit.disabled = false;
    }
  });

  $('#forgotPassword').addEventListener('click', () => {
    showMessage('Password recovery is not configured yet. Contact your EduVault administrator to reset your password.');
  });

  $$('.password-toggle').forEach(button => button.addEventListener('click', () => {
    const input = $('#' + button.dataset.password);
    if (!input) return;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  }));

  const sceneItems = scene ? $$('.scene-item', scene) : [];
  if (!reducedMotion && scene && window.matchMedia('(pointer: fine)').matches) {
    scene.addEventListener('pointermove', event => {
      const rect = scene.getBoundingClientRect();
      const dx = (event.clientX - rect.left) / rect.width - 0.5;
      const dy = (event.clientY - rect.top) / rect.height - 0.5;
      sceneItems.forEach(item => {
        const depth = Number(item.dataset.depth || 1);
        item.style.setProperty('--px', `${(-dx * depth * 12).toFixed(1)}px`);
        item.style.setProperty('--py', `${(-dy * depth * 9).toFixed(1)}px`);
      });
    });
    scene.addEventListener('pointerleave', () => sceneItems.forEach(item => {
      item.style.setProperty('--px', '0px');
      item.style.setProperty('--py', '0px');
    }));
    storyPanel.addEventListener('scroll', () => {
      const rect = scene.getBoundingClientRect();
      const offset = Math.max(-12, Math.min(12, (rect.top + rect.height / 2 - window.innerHeight / 2) * -0.025));
      sceneItems.forEach(item => item.style.setProperty('--scroll-shift', `${offset.toFixed(1)}px`));
    }, { passive: true });
  }

  sceneItems.forEach(item => { item.style.translate = 'var(--px, 0px) var(--py, 0px)'; });
  $('#backToTop').addEventListener('click', event => {
    event.preventDefault();
    storyPanel.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  });
  $$('a[href^="#"]:not(#backToTop)').forEach(link => {
    link.addEventListener('click', event => {
      const target = $(link.getAttribute('href'));
      if (!target || window.matchMedia('(max-width: 900px)').matches) return;
      event.preventDefault();
      const panelRect = storyPanel.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      storyPanel.scrollTo({
        top: storyPanel.scrollTop + targetRect.top - panelRect.top - 18,
        behavior: reducedMotion ? 'auto' : 'smooth'
      });
      if (target.id === 'authPanel') $('#loginId').focus({ preventScroll: true });
    });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(error => console.warn('PWA service worker registration failed.', error)));
  }
})();
