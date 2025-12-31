import { test, expect } from '@playwright/test';

test('has title and loads dashboard', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/SignsCheck/);

    // Check if version tag is visible
    const versionTag = page.locator('span', { hasText: /v0.8.5/ });
    await expect(versionTag).toBeVisible();
});
