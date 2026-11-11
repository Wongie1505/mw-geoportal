import { createElement } from '../shared/js/ui.js';

const WIDE = window.matchMedia('(min-width: 900px)');

// The slide-out menu of the dashboard. Each view is one link, and the part
// after the # in the address says which view is open.
export function setupSidebar(views, onShow) {
    const layout = document.getElementById('dashboard-body');
    const menu = document.getElementById('drawer-menu');
    const toggle = document.getElementById('menu-toggle');
    const close = document.getElementById('drawer-close');
    const backdrop = document.getElementById('drawer-backdrop');

    // The little count next to a link, by view id
    const counts = new Map();

    function setOpen(open) {
        layout.classList.toggle('drawer-open', open);
        toggle.setAttribute('aria-expanded', String(open));
    }

    function createLink(view) {
        const link = createElement('a', 'drawer-link');
        link.href = `#${view.id}`;
        link.dataset.view = view.id;

        const count = createElement('span', 'drawer-count');
        count.hidden = true;
        counts.set(view.id, count);

        link.append(createElement('span', '', view.label), count);
        return link;
    }

    // Headings only make sense when there is more than one group
    const main = views.filter(view => !view.bottom);
    const groups = new Set(main.map(view => view.group));
    let lastGroup;

    main.forEach(view => {
        if (groups.size > 1 && view.group !== lastGroup) {
            menu.append(createElement('p', 'drawer-heading', view.group));
            lastGroup = view.group;
        }
        menu.append(createLink(view));
    });

    // Links marked bottom sit at the foot of the menu
    const bottom = views.filter(view => view.bottom);
    if (bottom.length) {
        const end = createElement('div', 'drawer-bottom');
        bottom.forEach(view => end.append(createLink(view)));
        menu.append(end);
    }

    function currentView() {
        const id = location.hash.slice(1);
        return views.some(view => view.id === id) ? id : views[0].id;
    }

    function show() {
        const id = currentView();

        menu.querySelectorAll('a').forEach(link => {
            const active = link.dataset.view === id;
            link.classList.toggle('active', active);

            if (active) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });
        onShow(id);
    }

    toggle.addEventListener('click', () => {
        setOpen(!layout.classList.contains('drawer-open'));
    });
    close.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));

    // On a narrow screen the drawer covers the page, so choosing a link closes it
    menu.addEventListener('click', event => {
        if (event.target.closest('a') && !WIDE.matches) setOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !WIDE.matches && layout.classList.contains('drawer-open')) {
            setOpen(false);
            toggle.focus();
        }
    });

    WIDE.addEventListener('change', () => setOpen(WIDE.matches));
    window.addEventListener('hashchange', show);

    // Open on a wide screen, closed on a narrow one. This is set before the
    // menu is shown so it does not slide on page load.
    setOpen(WIDE.matches);
    layout.hidden = false;
    toggle.hidden = false;
    show();

    return {
        currentView,
        setBadge(id, number) {
            const count = counts.get(id);
            if (!count) return;
            count.textContent = String(number);
            count.hidden = number === 0;
        }
    };
}