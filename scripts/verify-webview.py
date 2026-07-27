from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "test" / "fixtures" / "rpc-webview-harness.html"
OUTPUT = Path(gettempdir()) / "omp-rpc-ui-proof"


def verify_view(page, name: str) -> Path:
    errors: list[str] = []
    page.on(
        "console",
        lambda message: errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.goto(HARNESS.as_uri())
    page.wait_for_load_state("networkidle")
    page.locator(".signal.passed").wait_for()
    page.locator(".message.advisory").wait_for()
    page.locator(".tool-card.complete").wait_for()

    assert page.get_by_text("claude-opus-5", exact=False).is_visible()
    if name == "desktop":
        assert page.get_by_text("GPT-5.6 Sol", exact=False).is_visible()
    assert page.get_by_text("loop_dispatch_plan", exact=True).is_visible()
    assert page.get_by_text("Stage scope is valid", exact=False).is_visible()
    assert page.locator("#composer-input").is_visible()

    page.locator("[data-tool-toggle='tool-verify']").click()
    assert page.locator("[data-tool-details='tool-verify']").is_visible()

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - "
        "document.documentElement.clientWidth"
    )
    assert overflow <= 1, f"{name} horizontal overflow: {overflow}px"
    assert not errors, f"{name} console errors: {errors}"

    screenshot = OUTPUT / f"rpc-webview-{name}.png"
    page.screenshot(path=str(screenshot), full_page=True)
    return screenshot


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        desktop = verify_view(
            browser.new_page(viewport={"width": 1440, "height": 900}),
            "desktop",
        )
        narrow = verify_view(
            browser.new_page(viewport={"width": 430, "height": 800}),
            "narrow",
        )
        browser.close()
    print(f"desktop={desktop}")
    print(f"narrow={narrow}")


if __name__ == "__main__":
    main()
