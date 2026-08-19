import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * The members-only path: every route requires a session, a signed-in learner
 * without goals is sent to onboarding, and the dashboard then shows that
 * learner's own figures rather than demonstration values.
 *
 * Needs a real Supabase project. The suite skips itself when the environment
 * is not configured, which is the case in CI, so the other specs still run
 * against the offline demonstration mode.
 *
 * Each test creates and deletes its own learner. Sharing one across tests
 * couples them through onboarding state, which makes the results depend on
 * execution order.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && serviceRole);

const PASSWORD = "MemberFlow1234!secure";

/** Creates a pre-confirmed learner; this project requires email confirmation. */
async function createLearner(request: APIRequestContext) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const response = await request.post(`${url}/auth/v1/admin/users`, {
    headers: { apikey: serviceRole!, Authorization: `Bearer ${serviceRole!}` },
    data: { email, password: PASSWORD, email_confirm: true },
  });
  expect(response.ok(), "could not create the test learner").toBeTruthy();
  return { email, id: (await response.json()).id as string };
}

async function deleteLearner(request: APIRequestContext, id: string) {
  await request.delete(`${url}/auth/v1/admin/users/${id}`, {
    headers: { apikey: serviceRole!, Authorization: `Bearer ${serviceRole!}` },
  });
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel("Adresse courriel").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

async function completeOnboarding(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Créer mon programme" }).click();
  await expect(page.getByRole("status")).toBeVisible();
}

test.describe("member access", () => {
  test.skip(!configured, "requires a configured Supabase project");
  // The dev server compiles routes on first request, so the first navigation
  // in each test can be slow.
  test.slow();

  test("a signed-out visitor cannot reach the platform", async ({ page }) => {
    await page.goto("/review");
    await expect(page).toHaveURL(/\/auth\?next=%2Freview/);
    await expect(page.getByRole("heading", { name: "Connectez-vous" })).toBeVisible();
  });

  test("signing in leads to onboarding, then a dashboard of real figures", async ({
    page,
    request,
  }) => {
    const learner = await createLearner(request);
    try {
      await signIn(page, learner.email);
      await completeOnboarding(page);

      await page.goto("/");
      // A learner who has just registered has earned nothing, and the
      // interface must say so rather than showing demonstration figures.
      await expect(page.getByText("0 XP")).toBeVisible();
      await expect(page.getByText(/démonstration/i)).toHaveCount(0);
      await expect(page.getByText("Alex Morgan")).toHaveCount(0);
      await expect(page.getByText("3 h 24 min")).toHaveCount(0);
    } finally {
      await deleteLearner(request, learner.id);
    }
  });

  test("signing out revokes access again", async ({ page, request }) => {
    const learner = await createLearner(request);
    try {
      await signIn(page, learner.email);
      await completeOnboarding(page);

      await page.goto("/");
      await page.getByRole("button", { name: "Se déconnecter" }).click();
      await expect(page).toHaveURL(/\/auth/);

      await page.goto("/");
      await expect(page).toHaveURL(/\/auth/);
    } finally {
      await deleteLearner(request, learner.id);
    }
  });
});
