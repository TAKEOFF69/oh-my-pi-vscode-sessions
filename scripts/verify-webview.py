import argparse
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


def paste_screenshot(page) -> str:
    return page.locator("#composer-input").evaluate(
        """async (composer) => {
          const canvas = document.createElement("canvas");
          canvas.width = 8;
          canvas.height = 8;
          const context = canvas.getContext("2d");
          context.fillStyle = "#2774c8";
          context.fillRect(0, 0, 8, 8);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const file = new File([blob], "screenshot.png", { type: "image/png" });
          const transfer = new DataTransfer();
          transfer.items.add(file);
          const event = new Event("paste", { bubbles: true, cancelable: true });
          Object.defineProperty(event, "clipboardData", { value: transfer });
          composer.dispatchEvent(event);
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return btoa(binary);
        }""",
    )


def delay_image_decode(page, milliseconds: int = 250) -> None:
    page.evaluate(
        """(delay) => {
          window.__OMP_ORIGINAL_CREATE_IMAGE_BITMAP__ ??= window.createImageBitmap;
          window.createImageBitmap = async (...args) => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return window.__OMP_ORIGINAL_CREATE_IMAGE_BITMAP__(...args);
          };
        }""",
        milliseconds,
    )


def restore_image_decode(page) -> None:
    page.evaluate(
        """() => {
          if (window.__OMP_ORIGINAL_CREATE_IMAGE_BITMAP__) {
            window.createImageBitmap = window.__OMP_ORIGINAL_CREATE_IMAGE_BITMAP__;
            delete window.__OMP_ORIGINAL_CREATE_IMAGE_BITMAP__;
          }
        }"""
    )


def assert_attachment_race_and_typing_stability(page, name: str) -> str:
    delay_image_decode(page)
    image_data = paste_screenshot(page)
    assert page.locator("#send-button").is_disabled(), (
        f"{name} send button enabled while screenshot preparation was pending"
    )
    page.locator(".attachment-remove").first.evaluate("(button) => button.click()")
    assert page.locator(".attachment-chip").count() == 0, (
        f"{name} did not remove the existing screenshot before decode completed"
    )
    page.locator(".attachment-chip").first.wait_for()
    page.wait_for_timeout(350)
    restore_image_decode(page)
    assert page.locator(".attachment-chip").count() == 1, (
        f"{name} resurrected a removed screenshot during concurrent paste"
    )
    stable = page.evaluate(
        """() => {
          const preview = document.querySelector('.attachment-chip img');
          const composer = document.querySelector('#composer-input');
          for (let index = 0; index < 200; index += 1) {
            composer.value = `typing stability ${index}`;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return preview === document.querySelector('.attachment-chip img');
        }"""
    )
    assert stable, f"{name} rebuilt screenshot previews while typing"
    return image_data


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
        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "extension_ui_request",
                    "method": "setStatus",
                    "statusKey": "status-only-proof",
                    "statusText": "ready",
                },
            },
        )
        page.locator(".activity").wait_for()
        assert page.get_by_text("status-only-proof", exact=True).is_hidden()
        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "extension_ui_request",
                    "method": "setStatus",
                    "statusKey": "status-only-proof",
                    "statusText": "",
                },
            },
        )
        page.locator(".empty-mark").wait_for()
    else:
        page.get_by_text("Stage is valid and dispatch is armed.", exact=True).wait_for()
        page.locator(".activity").wait_for()
        assert "Opus 5" in page.locator("#model-label").inner_text()
        assert page.locator(".message.assistant").count() == 1
        assert page.locator(".message.advisory").count() == 0
        assert page.locator(".message-meta").count() == 0
        assert page.get_by_text("Stage scope is valid", exact=False).count() == 0
        assert page.get_by_text("loop_dispatch_plan", exact=True).is_hidden()
        assert page.get_by_text("Dzialkopedia project policy loaded", exact=True).is_hidden()
        assert page.get_by_text("dzialki-model-lock", exact=True).is_hidden()

        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "message_start",
                    "message": {
                        "role": "custom",
                        "customType": "xdev-mount-notice",
                        "content": (
                            "<system-notice>\n"
                            "The xd:// device inventory changed.\n"
                            "- xd://mcp__telegram_send_message\n"
                            "</system-notice>"
                        ),
                    },
                },
            },
        )
        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "message_end",
                    "message": {
                        "role": "custom",
                        "customType": "xdev-mount-notice",
                        "content": (
                            "<system-notice>\n"
                            "The xd:// device inventory changed.\n"
                            "- xd://mcp__telegram_send_message\n"
                            "</system-notice>"
                        ),
                    },
                },
            },
        )
        dispatch_frame(
            page,
            {
                "type": "rpc",
                "frame": {
                    "type": "tool_execution_end",
                    "toolCallId": "tool-read-failed",
                    "toolName": "read",
                    "result": {"error": "missing session dossier"},
                    "isError": True,
                },
            },
        )
        assert page.get_by_text("mcp__telegram_send_message", exact=False).count() == 0
        assert not page.locator(".activity").evaluate("(details) => details.open"), (
            f"{name} auto-opened internal Activity after tool failure"
        )
        assert page.get_by_text("Activity · 1 failed", exact=True).is_visible()

        page.locator("#actions-button").click()
        assert page.get_by_text("Show OMP logs", exact=True).is_visible()
        page.keyboard.press("Escape")
        assert page.locator("#actions-menu").is_hidden()

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

    if not empty:
        page.locator(".activity > summary").click()
        page.locator(".tool-card.complete").wait_for()
        assert page.get_by_text("loop_dispatch_plan", exact=True).is_visible()
        assert page.get_by_text("Dzialkopedia project policy loaded", exact=True).is_visible()
        assert page.get_by_text("dzialki-model-lock", exact=True).is_visible()
        page.locator("[data-tool-toggle='tool-verify']").click()
        assert page.locator("[data-tool-details='tool-verify']").is_visible()

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
            "sessionName": "Verify OMP startup",
            "kind": "work",
            "parityRequired": True,
            "trustedProjectPolicy": True,
        },
    )
    dispatch_frame(page, {"type": "transport", "status": "starting"})
    assert page.locator("#session-name").inner_text() == "Verify OMP startup"
    assert page.get_by_text("wip/startup-proof", exact=True).count() == 0
    page.locator("#composer-input").fill("send button regression proof")
    assert page.locator("#send-button").is_disabled(), (
        f"{name} send button enabled before runtime readiness"
    )
    page.locator("#composer-input").press("Enter")
    assert page.locator("#composer-input").input_value() == (
        "send button regression proof"
    ), f"{name} startup draft was cleared"
    premature = [
        post
        for post in page.evaluate("() => window.__OMP_TEST_POSTS__")
        if post.get("type") in {"prompt", "steer", "follow_up"}
    ]
    assert premature == [], f"{name} posted prompt before runtime readiness"
    dispatch_frame(page, {"type": "parity", "ok": True})
    dispatch_frame(page, {"type": "transport", "status": "ready"})
    image_data = paste_screenshot(page)
    page.locator(".attachment-chip").wait_for()
    assert "images" not in page.evaluate(
        "() => JSON.parse(sessionStorage.getItem('omp-shared-view-state'))"
    ), f"{name} serialized screenshot bytes into per-keystroke webview state"
    dispatch_frame(
        page,
        {"type": "setComposer", "text": "text-only editor update"},
    )
    assert page.locator("#composer-input").input_value() == "text-only editor update"
    assert page.locator(".attachment-chip").count() == 1, (
        f"{name} text-only setComposer discarded screenshot attachments"
    )
    image_data = assert_attachment_race_and_typing_stability(page, name)
    page.locator("#composer-input").fill("send button regression proof")
    page.screenshot(
        path=str(OUTPUT / f"rpc-webview-{name}-attachment.png"),
        full_page=True,
    )
    assert page.locator("#send-button").is_enabled(), (
        f"{name} send button stayed disabled after typing"
    )
    page.locator("#send-button").click()
    posted = page.evaluate("() => window.__OMP_TEST_POSTS__")
    assert {
        "type": "prompt",
        "message": "send button regression proof",
        "images": [
            {
                "type": "image",
                "mimeType": "image/png",
                "data": image_data,
            }
        ],
    } in posted, f"{name} send click did not post prompt: {posted}"
    assert page.locator(".attachment-chip").count() == 0

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
            "parityRequired": True,
            "trustedProjectPolicy": False,
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
            "trustedProjectPolicy": True,
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
    image_data = paste_screenshot(page)
    page.locator(".attachment-chip").wait_for()
    image_data = assert_attachment_race_and_typing_stability(
        page, f"sidebar {name}"
    )
    page.screenshot(
        path=str(OUTPUT / f"sidebar-{name}-attachment.png"),
        full_page=True,
    )
    composer.fill("Recover exact RCN progress")
    composer.press("Enter")
    page.locator("#send-button").click(force=True)
    posts = page.evaluate("() => window.__OMP_SIDEBAR_POSTS__")
    creates = [post for post in posts if post.get("type") == "createSession"]
    assert creates == [
        {
            "type": "createSession",
            "prompt": "Recover exact RCN progress",
            "images": [
                {
                    "type": "image",
                    "mimeType": "image/png",
                    "data": image_data,
                }
            ],
        }
    ], f"sidebar {name} double-submitted first prompt: {creates}"

    dispatch_sidebar(
        page,
        {
            "type": "sessionCreationFailed",
            "draft": "Recover exact RCN progress",
            "images": [
                {
                    "type": "image",
                    "mimeType": "image/png",
                    "data": image_data,
                }
            ],
            "detail": "fixture failure",
        },
    )
    dispatch_sidebar(page, {"type": "state", "creating": False, "sessions": []})
    assert composer.input_value() == "Recover exact RCN progress"
    assert page.locator(".attachment-chip").count() == 1
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
    page.get_by_text("View all (50)", exact=True).click()
    assert page.locator(".chat-row").count() == 50
    assert elapsed < 80, f"sidebar 50-row patch took {elapsed:.1f} ms"
    assert not errors, f"sidebar {name} console errors: {errors}"

    page.close()
    return screenshot, elapsed


def verify_shared_surface_lifecycle(browser) -> None:
    page = browser.new_page(viewport={"width": 430, "height": 900})
    page.goto(SIDEBAR_HARNESS.as_uri())
    page.wait_for_load_state("networkidle")
    page.locator("#composer-input").fill("Start one shared-surface chat")
    page.locator("#composer-input").press("Enter")
    assert page.evaluate(
        "() => JSON.parse(sessionStorage.getItem('omp-shared-view-state')).draft"
    ) == "", "home prompt leaked into conversation webview state"

    page.goto(f"{HARNESS.as_uri()}?empty=1")
    page.wait_for_load_state("networkidle")
    assert page.locator("#composer-input").input_value() == ""
    dispatch_frame(page, {"type": "setComposer", "text": "per-chat draft"})
    assert page.locator("#composer-input").input_value() == "per-chat draft"
    page.evaluate(
        """() => {
          window.__OMP_TEST_POSTS__ = [];
          window.addEventListener("omp-fixture-post", (event) => {
            window.__OMP_TEST_POSTS__.push(event.detail);
          });
        }"""
    )
    page.locator("#sessions-button").click()
    assert {"type": "showSessions"} in page.evaluate(
        "() => window.__OMP_TEST_POSTS__"
    )

    page.goto(SIDEBAR_HARNESS.as_uri())
    page.wait_for_load_state("networkidle")
    dispatch_sidebar(page, {"type": "setDraft", "draft": ""})
    assert page.locator("#composer-input").input_value() == ""
    page.evaluate(
        """() => {
          window.__OMP_SIDEBAR_POSTS__ = [];
          window.addEventListener("omp-sidebar-post", (event) => {
            window.__OMP_SIDEBAR_POSTS__.push(event.detail);
          });
        }"""
    )
    page.get_by_text("Resume RCN classifier validation", exact=True).click()
    assert {"type": "focusSession", "id": "rcn"} in page.evaluate(
        "() => window.__OMP_SIDEBAR_POSTS__"
    )
    page.close()


def verify_untrusted_markdown(browser) -> None:
    page = browser.new_page(viewport={"width": 800, "height": 600})
    page.goto(f"{HARNESS.as_uri()}?empty=1")
    page.wait_for_load_state("networkidle")
    page.evaluate("() => { window.__OMP_XSS_SENTINEL__ = 0; }")
    payload = (
        '<img src=x onerror="window.__OMP_XSS_SENTINEL__ = 1"> '
        '<script>window.__OMP_XSS_SENTINEL__ = 2</script> '
        '[unsafe](javascript:window.__OMP_XSS_SENTINEL__=3)'
    )
    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "message_start",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": payload}],
                },
            },
        },
    )
    dispatch_frame(
        page,
        {
            "type": "rpc",
            "frame": {
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": payload}],
                },
            },
        },
    )
    message = page.locator(".message.assistant").last
    message.wait_for()
    assert page.evaluate("() => window.__OMP_XSS_SENTINEL__") == 0
    assert message.locator("script").count() == 0
    assert message.locator("img[onerror]").count() == 0
    assert message.locator('a[href^="javascript:"]').count() == 0
    assert "<script>" in message.inner_text()
    page.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--security-only",
        action="store_true",
        help="Run only untrusted Markdown/XSS regression",
    )
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        if args.security_only:
            verify_untrusted_markdown(browser)
            browser.close()
            print("untrusted_markdown=PASS")
            return
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
        verify_untrusted_markdown(browser)
        stream_average = verify_stream_performance(browser)
        sidebar_narrow, sidebar_narrow_ms = verify_sidebar(
            browser, 340, 980, "reference"
        )
        sidebar_wide, sidebar_wide_ms = verify_sidebar(
            browser, 430, 800, "wide"
        )
        verify_shared_surface_lifecycle(browser)
        browser.close()
    print(f"desktop={desktop}")
    print(f"narrow={narrow}")
    print(f"reference={reference}")
    print(f"stream_update_average_ms={stream_average:.1f}")
    print(f"sidebar_reference={sidebar_narrow} ({sidebar_narrow_ms:.1f}ms)")
    print(f"sidebar_wide={sidebar_wide} ({sidebar_wide_ms:.1f}ms)")


if __name__ == "__main__":
    main()
