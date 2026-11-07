import { getCurrentUser, signOut } from './auth.js';
import { createElement, describeRole } from './ui.js';

// Every page lives one folder below the site root, so links start with ../
const ROOT = '../';

// Add a line here whenever a new page is built.
// roles limits who sees the link. Leave it out to show it to everyone.
const LINKS = [
    { label: 'Home', href: 'home/home.html' },
    { label: 'Datasets', href: 'catalog/catalog.html' },
    { label: 'Dashboard', href: 'dashboard/dashboard.html', roles: ['user', 'member', 'manager', 'admin'] },
    { label: 'Contribute', href: 'contribute/contribute.html', roles: ['user', 'member', 'manager', 'admin'] }
];

function createLink(label, href, className) {
    const link = createElement('a', className, label);
    link.href = ROOT + href;

    // Mark the link for the page we are on
    if (location.pathname.includes('/' + href)) {
        link.setAttribute('aria-current', 'page');
    }
    return link;
}

function buildAccountArea(user) {
    const account = createElement('div', 'nav-account');

    if (!user) {
        account.append(
            createLink('Log in', 'login/login.html'),
            createLink('Register', 'register/register.html', 'nav-button')
        );
        return account;
    }

    const logout = createElement('button', 'nav-button', 'Log out');
    logout.type = 'button';
    logout.addEventListener('click', async () => {
        await signOut();
        location.href = ROOT + 'home/home.html';
    });

    account.append(
        createElement('span', 'nav-user', user.fullName || user.email),
        createElement('span', 'role-badge', describeRole(user)),
        logout
    );
    return account;
}

// Fills the <header id="site-header"> element on the page
export async function renderNav() {
    const header = document.getElementById('site-header');
    const user = await getCurrentUser();

    const inner = createElement('div', 'nav-inner');
    const brand = createLink('Malawi Geoportal', 'home/home.html', 'nav-brand');
    brand.removeAttribute('aria-current');

    const links = createElement('nav', 'nav-links');
    LINKS
        .filter(item => !item.roles || (user && item.roles.includes(user.role)))
        .forEach(item => links.append(createLink(item.label, item.href)));

    inner.append(brand, links, buildAccountArea(user));
    header.replaceChildren(inner);
}