from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "test" / "fixtures" / "rpc-webview-harness.html"
OUTPUT = Path(gettempdir()) / "omp-rpc-ui-proof"


def verify_view(page, name: str, *, empty: bool = False) -> Path:
    errors: list[str] = []
    page.on(
        "console",
        lambda message: errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.goto(f"{HARNESS.as_uri()}{'?empty=1' if empty else ''}")
    page.wait_for_load_state("networkidle")
    page.locator(".signal.passed").wait_for()
    page.get_by_text("Chats", exact=True).wait_for()
    page.get_by_text("Full access" if empty else "Loop control", exact=True).wait_for()
    page.get_by_text("Work locally", exact=True).wait_for()
    page.locator("#composer-input").wait_for()

    if empty:
        page.locator(".empty-mark").wait_for()
        assert page.locator(".message").count() == 0
    else:
        page.locator(".message.advisory").wait_for()
        page.locator(".tool-card.complete").wait_for()
        assert page.get_by_text("claude-opus-5", exact=False).is_visible()
        assert page.get_by_text("loop_dispatch_plan", exact=True).is_visible()
        assert page.get_by_text("Stage scope is valid", exact=False).is_visible()

        page.locator("#actions-button").click()
        assert page.get_by_text("Show OMP logs", exact=True).is_visible()
        page.keyboard.press("Escape")
        assert page.locator("#actions-menu").is_hidden()

        page.locator("[data-tool-toggle='tool-verify']").click()
        assert page.locator("[data-tool-details='tool-verify']").is_visible()

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - "
        "document.documentElement.clientWidth"
    )
    assert overflow <= 1, f"{name} horizontal overflow: {overflow}px"
    composer_bottom = page.locator(".local-context").bounding_box()
    assert composer_bottom, f"{name} local context missing"
    assert (
        composer_bottom["y"] + composer_bottom["height"] <= page.viewport_size["height"]
    ), f"{name} composer clipped below viewport: {composer_bottom}"
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
        reference = verify_view(
            browser.new_page(viewport={"width": 457, "height": 1000}),
            "reference-empty",
            empty=True,
        )
        browser.close()
    print(f"desktop={desktop}")
    print(f"narrow={narrow}")
    print(f"reference={reference}")


if __name__ == "__main__":
    main()
