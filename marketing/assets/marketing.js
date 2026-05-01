// Theme toggle
(function () {
  const stored = localStorage.getItem('theme');
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  else document.documentElement.setAttribute('data-theme', 'auto');

  window.toggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : (cur === 'light' ? 'auto' : 'dark');
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };
})();

// Footer year
document.addEventListener('DOMContentLoaded', () => {
  const y = document.querySelectorAll('.year');
  y.forEach((el) => (el.textContent = String(new Date().getFullYear())));
});

// Pricing monthly/annual toggle
window.togglePricing = function (period) {
  document.querySelectorAll('.pricing-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  document.querySelectorAll('[data-amount-monthly]').forEach((el) => {
    if (period === 'annual') {
      el.textContent = el.dataset.amountAnnual;
    } else {
      el.textContent = el.dataset.amountMonthly;
    }
  });
  document.querySelectorAll('[data-period-text]').forEach((el) => {
    el.textContent = period === 'annual' ? '/mo, billed yearly' : '/mo';
  });
};

// Mobile menu toggle
document.addEventListener('DOMContentLoaded', () => {
  const tog = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (!tog || !links) return;
  tog.addEventListener('click', () => {
    links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
    if (links.style.display === 'flex') {
      links.style.flexDirection = 'column';
      links.style.position = 'absolute';
      links.style.top = '100%';
      links.style.right = '24px';
      links.style.background = 'var(--surface-elevated)';
      links.style.border = '1px solid var(--border)';
      links.style.borderRadius = 'var(--radius-md)';
      links.style.padding = '8px';
      links.style.boxShadow = 'var(--shadow-lg)';
    }
  });
});
