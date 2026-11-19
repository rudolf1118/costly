/**
 * Development-only demo account: five AMD accounts and about five months of
 * income and expenses, for demonstrating the ledger before the data generator
 * (technical design §6, packages/data-generator) exists.
 *
 * Everything goes through the public HTTP API, as the web client would send
 * it, so every row passes the same validation, ownership checks and database
 * rules as real input. Nothing is written to the database directly.
 *
 *   pnpm db:seed:demo            seed, or verify an existing demo account
 *   pnpm db:seed:demo --dry-run  print the plan, touch nothing
 *
 * The credentials come from DEMO_EMAIL and DEMO_PASSWORD (apps/api/.env, which
 * git ignores), never from this file. The API URL is DEMO_API_URL, by default
 * http://localhost:$PORT. See docs/10-diploma/demo-account.md.
 *
 * Idempotent and safe: the demo user is seeded only while it has no accounts
 * and no transactions. If it already holds exactly the demo accounts, the run
 * only verifies balances. Any other state stops the run without writing.
 */

/** Fixed, so the same day always produces the same history. */
const RANDOM_SEED = 0x20261119;

const TIME_ZONE = 'Asia/Yerevan';

/** History starts on the first day of the month this many months back. */
const MONTHS_OF_HISTORY = 5;

type AccountKey = 'main' | 'savings' | 'cash' | 'secondary' | 'emergency';
type AccountType = 'checking' | 'cash' | 'savings' | 'credit_card';
type Kind = 'income' | 'expense';
type Nature = 'essential_fixed' | 'essential_variable' | 'discretionary';

interface DemoAccount {
  key: AccountKey;
  name: string;
  type: AccountType;
  /** Whole dram. */
  opening: bigint;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  { key: 'main', name: 'Main Bank Card', type: 'checking', opening: 850_000n },
  { key: 'savings', name: 'Savings Account', type: 'savings', opening: 2_500_000n },
  { key: 'cash', name: 'Cash Wallet', type: 'cash', opening: 120_000n },
  { key: 'secondary', name: 'Secondary Bank Card', type: 'checking', opening: 350_000n },
  { key: 'emergency', name: 'Emergency Fund', type: 'savings', opening: 1_000_000n },
];

/** A category by name, under a top-level parent or at the top level. */
interface CategoryRef {
  name: string;
  parent?: string;
  kind: Kind;
}

/** The user's own categories, for what the system set has no place for. */
interface CustomCategory extends CategoryRef {
  nature: Nature | null;
}

const CUSTOM_CATEGORIES: CustomCategory[] = [
  { name: 'Subscriptions', kind: 'expense', nature: 'discretionary' },
  { name: 'Coffee', parent: 'Food', kind: 'expense', nature: 'discretionary' },
  { name: 'University fees', parent: 'Education', kind: 'expense', nature: 'essential_fixed' },
  { name: 'Bonus', kind: 'income', nature: null },
];

const income = (name: string, parent?: string): CategoryRef => ({ name, parent, kind: 'income' });
const expense = (name: string, parent?: string): CategoryRef => ({
  name,
  parent,
  kind: 'expense',
});

const C = {
  salary: income('Salary'),
  freelance: income('Freelance'),
  investments: income('Investments'),
  gifts: income('Gifts'),
  bonus: income('Bonus'),
  rent: expense('Rent', 'Housing'),
  utilities: expense('Utilities', 'Housing'),
  internet: expense('Internet & phone', 'Housing'),
  groceries: expense('Groceries', 'Food'),
  restaurants: expense('Restaurants', 'Food'),
  coffee: expense('Coffee', 'Food'),
  fuel: expense('Fuel', 'Transport'),
  taxi: expense('Taxi', 'Transport'),
  pharmacy: expense('Pharmacy', 'Health'),
  doctors: expense('Doctors', 'Health'),
  courses: expense('Courses', 'Education'),
  books: expense('Books', 'Education'),
  university: expense('University fees', 'Education'),
  clothing: expense('Clothing', 'Shopping'),
  electronics: expense('Electronics', 'Shopping'),
  household: expense('Household', 'Shopping'),
  streaming: expense('Streaming', 'Entertainment'),
  events: expense('Events', 'Entertainment'),
  hobbies: expense('Hobbies', 'Entertainment'),
  subscriptions: expense('Subscriptions'),
  personalCare: expense('Personal care'),
  giftsOut: expense('Gifts & donations'),
  other: expense('Other expense'),
} satisfies Record<string, CategoryRef>;

interface Planned {
  account: AccountKey;
  type: Kind;
  category: CategoryRef;
  /** Whole dram; the API gets luma (× 100). */
  amount: bigint;
  occurredOn: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Deterministic randomness. The generator only ever produces integers; no
// amount passes through a floating-point calculation.

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Random {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  /** Whole dram in [min, max], a multiple of step. */
  dram(min: number, max: number, step: number): bigint {
    return BigInt(this.int(Math.ceil(min / step), Math.floor(max / step)) * step);
  }
  chance(percent: number): boolean {
    return this.int(1, 100) <= percent;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }
}

// ---------------------------------------------------------------------------
// Calendar dates as YYYY-MM-DD strings, computed in UTC so no local offset
// can shift a day.

function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

function ymd(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Moves a Saturday or Sunday back to Friday, as payroll does. */
function previousWorkday(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  const back = weekday === 6 ? 1 : weekday === 0 ? 2 : 0;
  parsed.setUTCDate(parsed.getUTCDate() - back);
  return parsed.toISOString().slice(0, 10);
}

/** A card charge for a USD price at that month's rate, rounded to whole dram. */
function usdCharge(usdCents: bigint, amdPerUsd: number): bigint {
  return (usdCents * BigInt(amdPerUsd) + 50n) / 100n;
}

// ---------------------------------------------------------------------------
// The plan.

interface Window {
  start: string;
  today: string;
  months: { year: number; month: number; lastDay: number }[];
}

function historyWindow(today: string): Window {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const months: Window['months'] = [];
  for (let back = MONTHS_OF_HISTORY; back >= 0; back--) {
    const index = year * 12 + (month - 1) - back;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    months.push({ year: y, month: m, lastDay: back === 0 ? day : daysInMonth(y, m) });
  }
  const first = months[0]!;
  return { start: ymd(first.year, first.month, 1), today, months };
}

function buildPlan(window: Window): Planned[] {
  const random = new Random(RANDOM_SEED);
  const plan: Planned[] = [];
  const add = (
    account: AccountKey,
    category: CategoryRef,
    amount: bigint,
    occurredOn: string | null,
    description: string,
  ): void => {
    if (occurredOn === null || occurredOn < window.start || occurredOn > window.today) return;
    plan.push({ account, type: category.kind, category, amount, occurredOn, description });
  };

  const months = window.months;
  const freelanceMonths = new Set<number>();
  while (freelanceMonths.size < 4) freelanceMonths.add(random.int(0, months.length - 1));
  const freelanceProjects = [
    'Freelance: landing page for a dental clinic',
    'Freelance: REST API integration',
    'Freelance: mobile app bug fixes',
    'Freelance: analytics dashboard redesign',
    'Freelance: online store checkout',
  ];
  let freelancePaid = 0;
  const giftMonth = random.int(0, months.length - 2);
  const bonusMonth = Math.min(3, months.length - 1);
  const dentistMonth = Math.min(3, months.length - 1);

  months.forEach(({ year, month, lastDay }, index) => {
    /** A date in this month, or null if the day hasn't come yet. */
    const on = (day: number): string | null =>
      day <= lastDay ? ymd(year, month, Math.min(day, daysInMonth(year, month))) : null;
    const anyDay = (from = 1, to = 28): string | null => on(random.int(from, to));
    const amdPerUsd = random.int(384, 396);
    const winter = month >= 10 || month <= 3;

    // Income.
    add('main', C.salary, 700_000n, previousWorkday(ymd(year, month, 5)), 'Monthly salary');
    if (freelanceMonths.has(index)) {
      add(
        'secondary',
        C.freelance,
        random.dram(300_000, 800_000, 5_000),
        anyDay(8, 27),
        freelanceProjects[freelancePaid++]!,
      );
    }
    add(
      'savings',
      C.investments,
      random.dram(17_400, 19_800, 10),
      on(28),
      'Deposit interest (net of tax)',
    );
    if (month % 3 === 0) {
      add(
        'emergency',
        C.investments,
        random.dram(19_500, 22_500, 10),
        on(28),
        'Quarterly deposit interest',
      );
    }
    if (index === giftMonth)
      add('cash', C.gifts, 50_000n, anyDay(10, 25), 'Birthday gift from family');
    if (index === bonusMonth)
      add('main', C.bonus, 150_000n, anyDay(24, 28), 'Quarterly performance bonus');

    // Housing and bills.
    add('main', C.rent, 250_000n, on(random.int(1, 3)), 'Apartment rent');
    add(
      'main',
      C.utilities,
      winter ? random.dram(17_000, 26_000, 10) : random.dram(11_000, 19_000, 10),
      anyDay(12, 17),
      'Electricity (ENA)',
    );
    add(
      'main',
      C.utilities,
      winter ? random.dram(9_000, 18_000, 10) : random.dram(2_800, 5_600, 10),
      anyDay(14, 20),
      'Gas bill',
    );
    if (month % 2 === 0)
      add('main', C.utilities, random.dram(2_600, 4_400, 10), anyDay(18, 24), 'Water (Veolia Jur)');
    add('main', C.internet, 8_000n, on(20), 'Home internet (Ucom)');

    // Food.
    const stores = ['SAS Supermarket', 'Yerevan City', 'Carrefour', 'Nor Zovq', 'Parma'];
    for (let n = random.int(3, 5); n > 0; n--) {
      add(
        random.chance(80) ? 'main' : 'secondary',
        C.groceries,
        random.dram(9_500, 38_000, 10),
        anyDay(1, 28),
        random.pick(stores),
      );
    }
    if (random.chance(50))
      add('cash', C.groceries, random.dram(3_000, 8_500, 100), anyDay(), 'GUM market produce');
    const restaurants = [
      'Lavash',
      'Sherep',
      'Tavern Yerevan',
      'Dolmama',
      'Pizza di Roma',
      'Mayrig',
    ];
    for (let n = random.int(2, 3); n > 0; n--) {
      add(
        random.chance(70) ? 'secondary' : 'main',
        C.restaurants,
        random.dram(9_000, 32_000, 100),
        anyDay(),
        random.pick(restaurants),
      );
    }
    for (let n = random.int(1, 2); n > 0; n--) {
      add(
        'cash',
        C.coffee,
        random.dram(1_200, 2_800, 100),
        anyDay(),
        random.pick(['Jazzve', 'Coffeeshop Company', 'Green Bean']),
      );
    }

    // Transport.
    for (let n = random.int(1, 2); n > 0; n--) {
      add(
        'main',
        C.fuel,
        random.dram(15_000, 30_000, random.chance(30) ? 500 : 1_000),
        anyDay(),
        random.pick(['Max Oil', 'Flash', 'CPS']),
      );
    }
    for (let n = random.int(1, 2); n > 0; n--) {
      add(
        random.chance(50) ? 'cash' : 'secondary',
        C.taxi,
        random.dram(900, 4_500, 100),
        anyDay(),
        random.pick(['Yandex Go', 'GG Taxi']),
      );
    }

    // Subscriptions, charged in USD.
    add('main', C.streaming, usdCharge(999n, amdPerUsd), on(8), 'Netflix');
    add('main', C.subscriptions, usdCharge(599n, amdPerUsd), on(14), 'Spotify Premium');
    if (index >= 2)
      add('secondary', C.subscriptions, usdCharge(2000n, amdPerUsd), on(22), 'ChatGPT Plus');

    // Leisure and shopping.
    if (random.chance(70)) {
      const concert = random.chance(30);
      add(
        'secondary',
        C.events,
        concert ? random.dram(15_000, 35_000, 1_000) : random.dram(4_000, 9_000, 500),
        anyDay(),
        concert ? 'Concert tickets' : 'Cinema (Kinopark)',
      );
    }
    if (random.chance(60)) {
      add(
        random.chance(60) ? 'secondary' : 'main',
        C.clothing,
        random.dram(12_000, 65_000, 100),
        anyDay(),
        random.pick(['Zara, Dalma Mall', 'LC Waikiki', 'Sneakers, Rossia Mall']),
      );
    }
    if (random.chance(35))
      add('main', C.household, random.dram(4_500, 24_000, 100), anyDay(), 'Home goods');
    if (index === 4) add('secondary', C.electronics, 89_000n, anyDay(), 'Wireless headphones');
    if (index === 2)
      add('secondary', C.hobbies, random.dram(18_000, 30_000, 500), anyDay(), 'Guitar lessons');

    // Health.
    if (random.chance(55))
      add(
        random.chance(50) ? 'cash' : 'main',
        C.pharmacy,
        random.dram(2_500, 14_000, 10),
        anyDay(),
        'Pharmacy',
      );
    if (index === 2) add('main', C.doctors, 18_000n, anyDay(), 'GP check-up');
    if (index === dentistMonth) add('emergency', C.doctors, 120_000n, anyDay(), 'Dental treatment');

    // Education: tuition installments at the start of each semester.
    if (month === 9 || month === 2)
      add('main', C.university, 75_000n, on(random.int(3, 10)), 'University tuition installment');
    if (month === 11)
      add('main', C.university, 75_000n, on(random.int(3, 10)), 'University tuition installment');
    if (random.chance(30))
      add('secondary', C.books, random.dram(4_000, 12_000, 100), anyDay(), 'Books (Bookinist)');
    if (index === 1)
      add('secondary', C.courses, usdCharge(1499n, amdPerUsd), anyDay(), 'Online course (Udemy)');

    // Everything else.
    if (random.chance(50))
      add('cash', C.personalCare, random.dram(3_000, 6_000, 500), anyDay(), 'Haircut');
    if (random.chance(30))
      add(
        'secondary',
        C.giftsOut,
        random.dram(10_000, 25_000, 1_000),
        anyDay(),
        "Friend's birthday gift",
      );
    if (random.chance(35))
      add(
        'cash',
        C.other,
        random.dram(1_500, 9_000, 100),
        anyDay(),
        random.pick(['Parking', 'Dry cleaning', 'Phone case', 'Post office']),
      );
  });

  plan.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
  return plan;
}

/** Opening balance + Σ income − Σ expense per account, in whole dram. */
function expectedBalances(plan: Planned[]): Map<AccountKey, bigint> {
  const balances = new Map(DEMO_ACCOUNTS.map((account) => [account.key, account.opening]));
  for (const row of plan) {
    const before = balances.get(row.account)!;
    balances.set(row.account, row.type === 'income' ? before + row.amount : before - row.amount);
  }
  return balances;
}

/** A demo history where an account dips below zero would look wrong, so the plan is checked. */
function assertNeverNegative(plan: Planned[]): void {
  const running = new Map(DEMO_ACCOUNTS.map((account) => [account.key, account.opening]));
  for (const row of plan) {
    const next = running.get(row.account)! + (row.type === 'income' ? row.amount : -row.amount);
    if (next < 0n) throw new Error(`plan takes ${row.account} below zero on ${row.occurredOn}`);
    running.set(row.account, next);
  }
}

// ---------------------------------------------------------------------------
// Output.

const out = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

function formatAmd(dram: bigint): string {
  const sign = dram < 0n ? '-' : '';
  const digits = (dram < 0n ? -dram : dram).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${digits} AMD`;
}

const LUMA_PER_DRAM = 100n;

/** API minor units (a decimal string) to whole dram; every demo amount is whole. */
function toDram(minor: string): bigint {
  const value = BigInt(minor);
  if (value % LUMA_PER_DRAM !== 0n) throw new Error(`unexpected fractional amount ${minor}`);
  return value / LUMA_PER_DRAM;
}

// ---------------------------------------------------------------------------
// Safety: local development only.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function assertLocal(apiUrl: URL): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'Refusing to run: NODE_ENV is production. The demo seed is for local development only.',
    );
  }
  if (!LOCAL_HOSTS.has(apiUrl.hostname)) {
    throw new Error(`Refusing to run: the API at ${apiUrl.origin} is not on this machine.`);
  }
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl !== undefined && !LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
    throw new Error('Refusing to run: DATABASE_URL does not point at a local database.');
  }
}

// ---------------------------------------------------------------------------
// The API client.

interface ApiAccount {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalance: string;
  openingDate: string;
  balance: string;
  archivedAt: string | null;
}

interface ApiCategory {
  id: string;
  name: string;
  kind: Kind;
  parentId: string | null;
  isSystem: boolean;
  archivedAt: string | null;
}

interface ApiTransaction {
  id: string;
  type: Kind;
  accountId: string;
  categoryId: string;
  amount: string;
  currency: string;
  occurredOn: string;
}

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, body: string, request: string) {
    super(`${request} failed with ${status}: ${body}`);
    this.status = status;
  }
}

class Api {
  private token: string | null = null;
  private readonly base: URL;
  constructor(base: URL) {
    this.base = base;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(new URL(path, this.base), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    // The request body may carry the password, so only the method and path are reported.
    if (!response.ok) throw new ApiError(response.status, text, `${method} ${path}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async login(email: string, password: string): Promise<boolean> {
    try {
      const session = await this.request<{ accessToken: string }>('POST', '/auth/login', {
        email,
        password,
      });
      this.token = session.accessToken;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return false;
      throw error;
    }
  }

  async allTransactions(): Promise<ApiTransaction[]> {
    const items: ApiTransaction[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page: { items: ApiTransaction[]; nextCursor: string | null } = await this.request(
        'GET',
        `/transactions?limit=100${query}`,
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }
}

function categoryLookup(categories: ApiCategory[]): (ref: CategoryRef) => ApiCategory | undefined {
  return (ref) => {
    const parent = ref.parent
      ? categories.find((c) => c.name === ref.parent && c.parentId === null && c.kind === ref.kind)
      : undefined;
    if (ref.parent && !parent) return undefined;
    return categories.find(
      (c) =>
        c.name === ref.name &&
        c.kind === ref.kind &&
        c.archivedAt === null &&
        c.parentId === (parent?.id ?? null),
    );
  };
}

// ---------------------------------------------------------------------------
// Verification: balances recomputed here from the listed transactions, and
// compared with what the Accounts API derives.

async function verify(api: Api, expected?: Map<AccountKey, bigint>): Promise<boolean> {
  const accounts = (await api.request<{ items: ApiAccount[] }>('GET', '/accounts?status=all'))
    .items;
  const transactions = await api.allTransactions();
  const net = new Map<string, bigint>();
  for (const t of transactions) {
    const amount = BigInt(t.amount);
    if (amount <= 0n) throw new Error(`transaction ${t.id} has a non-positive amount`);
    net.set(t.accountId, (net.get(t.accountId) ?? 0n) + (t.type === 'income' ? amount : -amount));
  }

  let ok = true;
  let total = 0n;
  out();
  out(
    'Account                 Opening              Expected             API balance          Txns',
  );
  for (const demo of DEMO_ACCOUNTS) {
    const account = accounts.find((a) => a.name === demo.name);
    if (!account) {
      out(`${demo.name}: missing`);
      ok = false;
      continue;
    }
    const count = transactions.filter((t) => t.accountId === account.id).length;
    const recomputed =
      toDram(account.openingBalance) + toDram((net.get(account.id) ?? 0n).toString());
    const reported = toDram(account.balance);
    const planned = expected?.get(demo.key);
    const matches = recomputed === reported && (planned === undefined || planned === reported);
    ok &&= matches;
    total += reported;
    out(
      `${demo.name.padEnd(24)}${formatAmd(toDram(account.openingBalance)).padEnd(21)}` +
        `${formatAmd(planned ?? recomputed).padEnd(21)}${formatAmd(reported).padEnd(21)}` +
        `${String(count).padStart(4)}${matches ? '' : '  MISMATCH'}`,
    );
  }
  const dates = transactions.map((t) => t.occurredOn).sort();
  out(`${'Total'.padEnd(66)}${formatAmd(total)}`);
  out();
  out(`Transactions: ${transactions.length}, from ${dates[0] ?? '-'} to ${dates.at(-1) ?? '-'}`);
  out(ok ? 'Balances verified: every account matches.' : 'Balance verification FAILED.');
  return ok;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const today = todayIn(TIME_ZONE);
  const window = historyWindow(today);
  const plan = buildPlan(window);
  assertNeverNegative(plan);

  if (dryRun) {
    out(
      `Plan: ${plan.length} transactions from ${plan[0]?.occurredOn} to ${plan.at(-1)?.occurredOn}`,
    );
    for (const row of plan) {
      const sign = row.type === 'income' ? '+' : '-';
      out(
        `${row.occurredOn}  ${row.account.padEnd(10)} ${(sign + formatAmd(row.amount)).padStart(16)}  ${row.category.name.padEnd(17)} ${row.description}`,
      );
    }
    for (const [key, balance] of expectedBalances(plan))
      out(`${key.padEnd(10)} ${formatAmd(balance)}`);
    return;
  }

  const email = process.env['DEMO_EMAIL'];
  const password = process.env['DEMO_PASSWORD'];
  if (!email || !password) {
    throw new Error('Set DEMO_EMAIL and DEMO_PASSWORD (in apps/api/.env, which git ignores).');
  }
  const apiUrl = new URL(
    process.env['DEMO_API_URL'] ?? `http://localhost:${process.env['PORT'] ?? '3100'}`,
  );
  assertLocal(apiUrl);
  const api = new Api(apiUrl);
  out(`API: ${apiUrl.origin}`);

  if (!(await api.login(email, password))) {
    try {
      await api.request('POST', '/auth/register', { email, password, timezone: TIME_ZONE });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw new Error(`${email} exists but the password doesn't match. Nothing was changed.`, {
          cause: error,
        });
      }
      throw error;
    }
    if (!(await api.login(email, password)))
      throw new Error('Login failed right after registration.');
    out(`Registered ${email}.`);
  } else {
    out(`Logged in as ${email}.`);
  }

  // Look before writing anything.
  const accounts = (await api.request<{ items: ApiAccount[] }>('GET', '/accounts?status=all'))
    .items;
  const existing = await api.request<{ items: ApiTransaction[] }>('GET', '/transactions?limit=1');
  const demoNames = new Set(DEMO_ACCOUNTS.map((account) => account.name));
  const isExactlyDemo =
    accounts.length === DEMO_ACCOUNTS.length && accounts.every((a) => demoNames.has(a.name));

  if (accounts.length > 0 || existing.items.length > 0) {
    if (isExactlyDemo && existing.items.length > 0) {
      out('The demo account is already seeded. Nothing was written; verifying balances.');
      process.exitCode = (await verify(api)) ? 0 : 1;
      return;
    }
    throw new Error(
      `${email} already has ${accounts.length} account(s) that are not exactly the demo set, or ` +
        'transactions without accounts. They cannot be told apart from real data, so nothing was ' +
        'changed. Inspect the account in the app and remove the data by hand if it is disposable.',
    );
  }

  // Categories: system ones are used as they are; the few custom ones are reused if present.
  let categories = (await api.request<{ items: ApiCategory[] }>('GET', '/categories')).items;
  for (const custom of CUSTOM_CATEGORIES) {
    if (categoryLookup(categories)(custom)) continue;
    const parentId = custom.parent
      ? categoryLookup(categories)({ name: custom.parent, kind: custom.kind })?.id
      : null;
    if (parentId === undefined) throw new Error(`parent category ${custom.parent} not found`);
    await api.request('POST', '/categories', {
      name: custom.name,
      kind: custom.kind,
      nature: custom.nature,
      parentId,
    });
    out(`Created category ${custom.parent ? `${custom.parent} › ` : ''}${custom.name}.`);
  }
  categories = (await api.request<{ items: ApiCategory[] }>('GET', '/categories')).items;
  const findCategory = categoryLookup(categories);

  const ids = new Map<AccountKey, string>();
  for (const demo of DEMO_ACCOUNTS) {
    const created = await api.request<ApiAccount>('POST', '/accounts', {
      name: demo.name,
      type: demo.type,
      currency: 'AMD',
      openingBalance: (demo.opening * LUMA_PER_DRAM).toString(),
      openingDate: window.start,
    });
    ids.set(demo.key, created.id);
  }
  out(`Created ${DEMO_ACCOUNTS.length} accounts, opened ${window.start}.`);

  for (const row of plan) {
    const category = findCategory(row.category);
    if (!category) throw new Error(`category ${row.category.name} not found`);
    await api.request('POST', '/transactions', {
      type: row.type,
      accountId: ids.get(row.account),
      categoryId: category.id,
      amount: (row.amount * LUMA_PER_DRAM).toString(),
      occurredOn: row.occurredOn,
      description: row.description,
    });
  }
  out(`Created ${plan.length} transactions.`);

  process.exitCode = (await verify(api, expectedBalances(plan))) ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
