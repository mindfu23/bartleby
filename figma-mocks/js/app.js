document.addEventListener('DOMContentLoaded', () => {
  const themeButtons = document.querySelectorAll('.theme-switcher button');
  const navTabs = document.querySelectorAll('.nav-tab');
  const pages = document.querySelectorAll('.page');

  // Theme switching
  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      themeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Page navigation
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPage = tab.dataset.page;

      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      pages.forEach(page => {
        page.classList.remove('active');
        if (page.id === `page-${targetPage}`) {
          page.classList.add('active');
        }
      });
    });
  });

  // Back button navigation
  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      navTabs[0].classList.add('active');
      pages.forEach(p => p.classList.remove('active'));
      document.getElementById('page-home').classList.add('active');
    });
  });
});
