import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatError } from '../api.js';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';

/** Minimal fake API: routes keyed by "METHOD /path". Handlers may be objects or (body) => object. */
function mockApi(routes) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      const key = `${opts.method || 'GET'} ${new URL(url, 'http://localhost').pathname}`;
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      calls.push({ key, body });
      const handler = routes[key];
      if (!handler) return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) };
      const r = typeof handler === 'function' ? handler(body) : handler;
      const status = r.status ?? 200;
      return { ok: status < 400, status, json: async () => r.body ?? null };
    }),
  );
  return calls;
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

const signedOut = { 'GET /api/me': { status: 401, body: { detail: 'Authentication required' } } };
const signedIn = { 'GET /api/me': { body: { username: 'siva', full_name: null } }, 'GET /api/history': { body: { total: 0, history: [] } } };

beforeEach(() => vi.spyOn(window, 'alert').mockImplementation(() => {}));
afterEach(() => vi.unstubAllGlobals());

describe('formatError', () => {
  test('handles strings, FastAPI-style lists, objects and empties', () => {
    expect(formatError('Nope')).toBe('Nope');
    expect(formatError([{ loc: ['body', 'username'], msg: 'Too short' }, { msg: 'Other' }])).toBe('body.username: Too short Other');
    expect(formatError({ msg: 'Bad' })).toBe('Bad');
    expect(formatError(null, 'Fallback')).toBe('Fallback');
  });
});

describe('routing and auth guard', () => {
  test('landing page is public', async () => {
    mockApi(signedOut);
    renderAt('/');
    expect(await screen.findByText(/Start Planning Free/)).toBeInTheDocument();
  });

  test.each(['/dashboard', '/history', '/home-planner', '/party-planner', '/jewelry-planner'])('%s redirects to sign-in when signed out', async (path) => {
    mockApi(signedOut);
    renderAt(path);
    expect(await screen.findByText('Your session ended. Please sign in again.')).toBeInTheDocument();
  });

  test('signed-in user sees the dashboard with their name', async () => {
    mockApi(signedIn);
    renderAt('/dashboard');
    expect(await screen.findByText(/Welcome back,/)).toBeInTheDocument();
    expect(screen.getAllByText(/siva/).length).toBeGreaterThan(0);
  });

  test('unknown routes go home', async () => {
    mockApi(signedOut);
    renderAt('/does-not-exist');
    expect(await screen.findByText(/Start Planning Free/)).toBeInTheDocument();
  });
});

describe('login', () => {
  test('success goes to the dashboard', async () => {
    let loggedIn = false;
    const calls = mockApi({
      'GET /api/me': () => (loggedIn ? { body: { username: 'siva', full_name: null } } : { status: 401, body: { detail: 'Authentication required' } }),
      'POST /api/token': () => { loggedIn = true; return { body: { access_token: 't', token_type: 'bearer' } }; },
      'GET /api/history': { body: { total: 0, history: [] } },
    });
    renderAt('/login');
    await screen.findByText('Welcome Back 👋');
    fireEvent.change(document.getElementById('username'), { target: { value: 'siva' } });
    fireEvent.change(document.getElementById('password'), { target: { value: 'secret-pass' } });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText(/Welcome back,/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/token').body).toEqual({ username: 'siva', password: 'secret-pass' });
  });

  test('wrong password shows the server message and re-enables the button', async () => {
    mockApi({ ...signedOut, 'POST /api/token': { status: 401, body: { detail: 'Incorrect username or password' } } });
    renderAt('/login');
    await screen.findByText('Welcome Back 👋');
    fireEvent.change(document.getElementById('username'), { target: { value: 'siva' } });
    fireEvent.change(document.getElementById('password'), { target: { value: 'wrong' } });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('submitBtn')).not.toBeDisabled());
    expect(document.getElementById('submitBtn')).toHaveTextContent('Sign In →');
  });

  test('network failure shows a connection error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('/api/me')) return { ok: false, status: 401, json: async () => ({}) };
      throw new Error('offline');
    }));
    renderAt('/login');
    await screen.findByText('Welcome Back 👋');
    fireEvent.change(document.getElementById('username'), { target: { value: 'a' } });
    fireEvent.change(document.getElementById('password'), { target: { value: 'b' } });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText('Connection error. Please try again.')).toBeInTheDocument();
  });
});

describe('register', () => {
  const fill = (v) => {
    for (const [id, value] of Object.entries(v)) fireEvent.change(document.getElementById(id), { target: { value } });
  };

  test('mismatched passwords are caught client-side without calling the API', async () => {
    const calls = mockApi(signedOut);
    renderAt('/register');
    await screen.findByRole('button', { name: /Create Account/ });
    fill({ username: 'newuser', password: 'password-1', confirm: 'password-2' });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText('Passwords do not match!')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/register')).toBe(false);
  });

  test('server validation errors are shown readably', async () => {
    mockApi({ ...signedOut, 'POST /api/register': { status: 422, body: { detail: [{ loc: ['body', 'username'], msg: 'String should have at least 3 characters' }] } } });
    renderAt('/register');
    await screen.findByRole('button', { name: /Create Account/ });
    fill({ username: 'ab', password: 'password-1', confirm: 'password-1' });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText('body.username: String should have at least 3 characters')).toBeInTheDocument();
  });

  test('success sends the right payload and shows the confirmation', async () => {
    const calls = mockApi({ ...signedOut, 'POST /api/register': { status: 201, body: { message: 'ok' } } });
    renderAt('/register');
    await screen.findByRole('button', { name: /Create Account/ });
    fill({ username: 'newuser', fullname: 'New User', email: 'n@x.com', password: 'password-1', confirm: 'password-1' });
    fireEvent.click(document.getElementById('submitBtn'));
    expect(await screen.findByText(/Account created/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/register').body).toEqual({ username: 'newuser', full_name: 'New User', email: 'n@x.com', password: 'password-1' });
  });
});

describe('planners', () => {
  test('required fields are validated before any request', async () => {
    const calls = mockApi(signedIn);
    renderAt('/home-planner');
    await screen.findByText('Home Interior Budget Planner');
    fireEvent.click(document.getElementById('genBtn'));
    expect(window.alert).toHaveBeenCalledWith('Please fill in Budget, Rooms, and Style.');
    expect(calls.some((c) => c.key === 'POST /api/generate-home')).toBe(false);
  });

  test('a plan is requested with the expected payload and rendered', async () => {
    const plan = { categories: [{ name: 'Lighting', icon: '💡', allocation: 5000, items: [{ name: 'LED bulb', description: 'Warm', price: 500, quantity: 2 }] }], tips: ['Buy LEDs'] };
    const calls = mockApi({ ...signedIn, 'POST /api/generate-home': { body: { recommendations: JSON.stringify(plan), source: 'gemini', id: '1' } } });
    renderAt('/home-planner');
    await screen.findByText('Home Interior Budget Planner');
    fireEvent.change(document.getElementById('budget'), { target: { value: '50000' } });
    fireEvent.change(document.getElementById('rooms'), { target: { value: '2' } });
    fireEvent.change(document.getElementById('style'), { target: { value: 'Minimalist' } });
    fireEvent.click(document.getElementById('r_living'));
    fireEvent.click(document.getElementById('genBtn'));
    expect(await screen.findByText('LED bulb')).toBeInTheDocument();
    expect(document.getElementById('resultSource')).toHaveTextContent('✦ Gemini recommendation');
    expect(document.getElementById('bsRemaining')).toHaveTextContent('₹45,000');
    const sent = calls.find((c) => c.key === 'POST /api/generate-home').body;
    expect(sent).toMatchObject({ budget: 50000, rooms: '2', style: 'Minimalist', room_types: ['Living Room'], platforms: ['Amazon', 'Flipkart', 'IKEA'], num_lights: 0 });
    // client-side fallback shopping links are built when the server sent none
    expect(screen.getAllByRole('link', { name: /Amazon/ })[0].getAttribute('href')).toBe('https://www.amazon.in/s?k=LED%20bulb');
  });

  test('a 401 from the API sends the user back to sign-in', async () => {
    mockApi({ ...signedIn, 'POST /api/generate-party': { status: 401, body: { detail: 'Authentication required' } } });
    renderAt('/party-planner');
    await screen.findByText('Party Budget Planner');
    fireEvent.change(document.getElementById('budget'), { target: { value: '30000' } });
    fireEvent.change(document.getElementById('guests'), { target: { value: '40' } });
    fireEvent.change(document.getElementById('eventType'), { target: { value: 'Birthday Party' } });
    fireEvent.click(document.getElementById('genBtn'));
    expect(await screen.findByText('Your session ended. Please sign in again.')).toBeInTheDocument();
  });

  test('server errors are surfaced in an alert and the form stays usable', async () => {
    mockApi({ ...signedIn, 'POST /api/generate-jewelry': { status: 422, body: { detail: 'The outfit image is not a valid supported image' } } });
    renderAt('/jewelry-planner');
    await screen.findByText('Jewelry Budget Planner');
    fireEvent.change(document.getElementById('budget'), { target: { value: '10000' } });
    fireEvent.change(document.getElementById('occasion'), { target: { value: 'Wedding' } });
    fireEvent.click(document.getElementById('genBtn'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Error: The outfit image is not a valid supported image'));
    expect(document.getElementById('genBtn')).not.toBeDisabled();
  });
});

describe('history and logout', () => {
  test('history shows newest first, filters and clears', async () => {
    const mk = (n, category) => ({ id: `id${n}`, category, budget: 1000 * n, preferences: {}, result: JSON.stringify({ tips: [`tip ${n}`] }), timestamp: `2026-10-0${n}T10:00:00.000000+00:00` });
    let history = [mk(3, 'jewelry'), mk(2, 'party'), mk(1, 'home')];
    mockApi({
      ...signedIn,
      'GET /api/history': () => ({ body: { total: history.length, history } }),
      'DELETE /api/history': () => { history = []; return { body: { deleted: 3 } }; },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/history');
    await screen.findByText('3 recommendations');
    const order = [...document.querySelectorAll('.history-card')].map((c) => c.dataset.category);
    expect(order).toEqual(['jewelry', 'party', 'home']);

    fireEvent.click(screen.getByRole('button', { name: /💍 Jewelry/ }));
    expect(document.querySelectorAll('.history-card')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /Clear History/ }));
    expect(await screen.findByText('No History Yet')).toBeInTheDocument();
  });

  test('logout calls the API and lands on a clean sign-in page', async () => {
    const calls = mockApi({ ...signedIn, 'POST /api/logout': { status: 204 } });
    renderAt('/dashboard');
    await screen.findByText(/Welcome back,/);
    fireEvent.click(screen.getByRole('link', { name: 'Logout' }));
    expect(await screen.findByText('Welcome Back 👋')).toBeInTheDocument();
    expect(screen.queryByText('Your session ended. Please sign in again.')).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/logout')).toBe(true);
  });
});
