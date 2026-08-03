from pathlib import Path
from tempfile import gettempdir

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "test" / "fixtures" / "rpc-webview-harness.html"
SIDEBAR_HARNESS = ROOT / "test" / "fixtures" / "sidebar-webview-harness.html"
OUTPUT = Path(gettempdir()) / "omp-rpc-ui-proof"


def dispatch_frame(page, frame: dict) -> None:
    page.evaluate(
        """(frame) => new Promise((resolve) => {
          window.dispatchEvent(new CustomEvent("omp-fixture-frame", { detail: frame }));
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })""",
        frame,
    )


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
        assert page.get_by_text("Opus 5", exact=False).is_visible()
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

    page.evaluate(
        """() => {
          window.__OMP_TEST_POSTS__ = [];
          window.addEventListener("omp-fixture-post", (event) => {
            window.__OMP_TEST_POSTS__.push(event.detail);
          });
        }"""
    )
    dispatch_frame(
        page,
        {
            "type": "bootstrap",
            "cwd": "C:\\worktrees\\startup-proof",
            "branch": "wip/startup-proof",
            "kind": "work",
            "parityRequired": True,
        },
    )
    dispatch_frame(page, {"type": "transport", "status": "starting"})
    page.locator("#composer-input").fill("send button regression proof")
    assert page.locator("#send-button").is_disabled(), (
        f"{name} send button enabled before runtime readiness"
    )
    page.locator("#composer-input").press("Enter")
    assert page.locator("#composer-input").input_value() == (
        "send button regression proof"
    ), f"{name} startup draft was cleared"
    assert page.evaluate("() => window.__OMP_TEST_POSTS__") == [], (
        f"{name} posted prompt before runtime readiness"
    )
    dispatch_frame(page, {"type": "parity", "ok": True})
    dispatch_frame(page, {"type": "transport", "status": "ready"})
    assert page.locator("#send-button").is_enabled(), (
        f"{name} send button stayed disabled after typing"
    )
    page.locator("#send-button").click()
    posted = page.evaluate("() => window.__OMP_TEST_POSTS__")
    assert {
        "type": "prompt",
        "message": "send button regression proof",
    } in posted, f"{name} send click did not post prompt: {posted}"

    if not empty:
        assert page.locator("[data-tool-details='tool-verify']").is_visible()
        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "notice",
                    "level": "info",
                    "source": "proof",
                    "message": "later frame",
                },
            },
        )
        assert page.locator("[data-tool-details='tool-verify']").is_visible(), (
            f"{name} expanded tool evidence collapsed after later frame"
        )

    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "extension_ui_request",
                "id": f"request-{name}",
                "method": "input",
                "title": "Runtime input",
                "prefill": "base",
            },
        },
    )
    request_input = page.locator("#request-layer [data-request-value]")
    request_input.fill("operator typing")
    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "notice",
                "level": "info",
                "source": "proof",
                "message": "background frame",
            },
        },
    )
    assert request_input.input_value() == "operator typing", (
        f"{name} request input reset after unrelated frame"
    )
    assert request_input.evaluate("element => document.activeElement === element"), (
        f"{name} request input lost focus after unrelated frame"
    )

    dispatch_frame(
        page,
        {
            "type": "bootstrap",
            "cwd": "C:\\generic",
            "kind": "work",
            "parityRequired": False,
        },
    )
    dispatch_frame(page, {"type": "parity", "ok": True})
    page.get_by_text("Custom access", exact=True).wait_for()
    dispatch_frame(
        page,
        {
            "type": "bootstrap",
            "cwd": "C:\\worktrees\\blocked-loop",
            "kind": "loop",
            "parityRequired": True,
        },
    )
    dispatch_frame(
        page,
        {"type": "parity", "ok": False, "detail": "proof failure"},
    )
    page.get_by_text("Access blocked", exact=True).wait_for()
    return screenshot


def verify_stream_performance(browser) -> float:
    page = browser.new_page(viewport={"width": 1000, "height": 800})
    page.goto(f"{HARNESS.as_uri()}?empty=1")
    page.wait_for_load_state("networkidle")
    messages = [
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": f"History {index}: **cached markdown** and stable DOM.",
                }
            ],
        }
        for index in range(1000)
    ]
    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "response",
                "command": "get_messages",
                "success": True,
                "data": {"messages": messages},
            },
        },
    )
    assert page.locator("[data-message-key]").count() == 1000
    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "message_start",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "stream 0"}],
                },
            },
        },
    )
    durations = []
    for index in range(12):
        duration = page.evaluate(
            """(index) => new Promise((resolve) => {
              const started = performance.now();
              window.dispatchEvent(new CustomEvent("omp-fixture-frame", {
                detail: {
                  type: "rpc",
                  frame: {
                    type: "message_update",
                    message: {
                      role: "assistant",
                      content: [{ type: "text", text: `stream ${index}` }]
                    }
                  }
                }
              }));
              requestAnimationFrame(() => requestAnimationFrame(() => {
                resolve(performance.now() - started);
              }));
            })""",
            index,
        )
        durations.append(float(duration))
    average = sum(durations) / len(durations)
    assert average < 80, f"long-history stream update averaged {average:.1f} ms"
    page.close()
    return average


def dispatch_sidebar(page, frame: dict) -> None:
    page.evaluate(
        """(frame) => new Promise((resolve) => {
          window.dispatchEvent(new CustomEvent("omp-sidebar-frame", { detail: frame }));
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })""",
        frame,
    )


def verify_sidebar(browser, width: int, height: int, name: str) -> tuple[Path, float]:
    page = browser.new_page(viewport={"width": width, "height": height})
    errors: list[str] = []
    page.on(
        "console",
        lambda message: errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.goto(SIDEBAR_HARNESS.as_uri())
    page.wait_for_load_state("networkidle")
    page.get_by_text("Chats", exact=True).wait_for()
    page.get_by_text("Resume RCN classifier validation", exact=True).wait_for()
    page.get_by_text("Opus 5 · Extra High", exact=True).wait_for()
    page.get_by_text("Work locally", exact=True).wait_for()
    assert page.locator("#composer-input").is_visible()
    assert page.get_by_text("wip/20260803-omp-session", exact=False).count() == 0
    assert page.get_by_text("New session", exact=False).count() == 0

    overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert overflow <= 1, f"sidebar {name} horizontal overflow: {overflow}px"
    local_context = page.locator(".local-context").bounding_box()
    assert local_context
    assert local_context["y"] + local_context["height"] <= height
    assert local_context["y"] > height * 0.72, (
        f"sidebar {name} composer is not bottom-docked: {local_context}"
    )

    screenshot = OUTPUT / f"sidebar-{name}.png"
    page.screenshot(path=str(screenshot), full_page=True)

    page.evaluate(
        """() => {
          window.__OMP_SIDEBAR_POSTS__ = [];
          window.addEventListener("omp-sidebar-post", (event) => {
            window.__OMP_SIDEBAR_POSTS__.push(event.detail);
          });
        }"""
    )
    composer = page.locator("#composer-input")
    composer.fill("Recover exact RCN progress")
    composer.press("Enter")
    page.locator("#send-button").click(force=True)
    posts = page.evaluate("() => window.__OMP_SIDEBAR_POSTS__")
    creates = [post for post in posts if post.get("type") == "createSession"]
    assert creates == [
        {"type": "createSession", "prompt": "Recover exact RCN progress"}
    ], f"sidebar {name} double-submitted first prompt: {creates}"

    dispatch_sidebar(
        page,
        {
            "type": "sessionCreationFailed",
            "draft": "Recover exact RCN progress",
            "detail": "fixture failure",
        },
    )
    dispatch_sidebar(page, {"type": "state", "creating": False, "sessions": []})
    assert composer.input_value() == "Recover exact RCN progress"
    assert page.get_by_text("fixture failure", exact=True).is_visible()

    sessions = [
        {
            "id": f"session-{index}",
            "label": f"Contextual session {index}",
            "cwd": f"C:\\worktrees\\session-{index}",
            "kind": "work",
            "status": "closed",
            "active": False,
            "live": False,
            "updatedAt": 1_700_000_000_000 + index,
        }
        for index in range(50)
    ]
    started = page.evaluate("() => performance.now()")
    dispatch_sidebar(page, {"type": "state", "creating": False, "sessions": sessions})
    elapsed = float(page.evaluate("(start) => performance.now() - start", started))
    assert page.locator(".chat-row").count() == 50
    assert elapsed < 80, f"sidebar 50-row patch took {elapsed:.1f} ms"
    assert not errors, f"sidebar {name} console errors: {errors}"

    page.close()
    return screenshot, elapsed


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
        stream_average = verify_stream_performance(browser)
        sidebar_narrow, sidebar_narrow_ms = verify_sidebar(
            browser, 340, 980, "reference"
        )
        sidebar_wide, sidebar_wide_ms = verify_sidebar(
            browser, 430, 800, "wide"
        )
        browser.close()
    print(f"desktop={desktop}")
    print(f"narrow={narrow}")
    print(f"reference={reference}")
    print(f"stream_update_average_ms={stream_average:.1f}")
    print(f"sidebar_reference={sidebar_narrow} ({sidebar_narrow_ms:.1f}ms)")
    print(f"sidebar_wide={sidebar_wide} ({sidebar_wide_ms:.1f}ms)")


if __name__ == "__main__":
    main()
