import { getToken, fetchCurrentUser, logout } from './auth.js';


function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureAccountDropdown({ user }) {
  const accountBtn = document.getElementById('navAccountBtn');
  if (!accountBtn) return;

  if (!user) {
    accountBtn.setAttribute('aria-label', 'Sign in');
    accountBtn.textContent = 'login';
    accountBtn.style.cursor = 'pointer';
    accountBtn.onclick = () => (window.location.href = 'login.html');
    return;
  }

  const initial = (user?.username || 'U')[0]?.toUpperCase?.() || 'U';
  accountBtn.setAttribute('aria-label', 'Account menu');
  accountBtn.textContent = '';

  const chip = document.createElement('div');
  chip.className =
    'w-10 h-10 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-sm font-bold';
  chip.textContent = initial;
  accountBtn.appendChild(chip);

  const menu = document.createElement('div');
  menu.id = 'navAccountMenu';
  menu.className = 'hidden fixed z-50 w-72 bg-surface-container-lowest rounded-xl editorial-shadow p-5';
  menu.innerHTML = `
    <div class="flex items-center gap-4 mb-4">
      <div class="w-12 h-12 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-label text-base font-bold">${escapeHtml(
        initial
      )}</div>
      <div class="min-w-0">
        <div class="font-label font-bold text-sm truncate">${escapeHtml(user?.username || 'User')}</div>
        <div class="font-label text-xs opacity-60 truncate">${escapeHtml(user?.email || '')}</div>
      </div>
    </div>
    <div class="h-px w-full bg-on-surface/10 my-4"></div>
    <a class="block font-label text-sm py-2 hover:text-primary transition-colors" href="profile.html?id=${encodeURIComponent(
      user?.id ?? ''
    )}">Profile</a>
    <button id="navLogoutBtn" class="w-full text-left font-label text-sm py-2 hover:text-primary transition-colors" type="button">Log out</button>
  `;
  document.body.appendChild(menu);

  function positionMenu() {
    const rect = accountBtn.getBoundingClientRect();
    const width = 288;
    const margin = 16;
    const left = Math.min(window.innerWidth - width - margin, Math.max(margin, rect.right - width));
    const top = rect.bottom + 10;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openMenu() {
    positionMenu();
    menu.classList.remove('hidden');
  }
  function closeMenu() {
    menu.classList.add('hidden');
  }
  function toggleMenu() {
    if (menu.classList.contains('hidden')) openMenu();
    else closeMenu();
  }

  accountBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleMenu();
  };
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', closeMenu);
  window.addEventListener('scroll', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });
  window.addEventListener('resize', () => {
    if (!menu.classList.contains('hidden')) positionMenu();
  });

  const logoutBtn = menu.querySelector('#navLogoutBtn');
  logoutBtn?.addEventListener('click', () => logout('login.html'));
}

async function main() {
  const token = getToken();
  const user = token ? await fetchCurrentUser({ token, redirectOnFail: null }) : null;
  ensureAccountDropdown({ user });
}

main();

