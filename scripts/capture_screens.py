"""開発環境の画面を撮影する。検索の語はサービスを問わない一般の語にする。"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:5190"


def main() -> None:
    output = pathlib.Path(sys.argv[1])
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for theme in ("light", "dark"):
            context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ja-JP")
            context.add_init_script(f"localStorage.setItem('mds.theme', '{theme}')")
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            page.goto(f"{BASE_URL}/", wait_until="networkidle")
            page.screenshot(path=output / f"home-{theme}.png")
            page.goto(f"{BASE_URL}/?query=%E9%9F%B3%E6%A5%BD", wait_until="networkidle")
            page.wait_for_selector("table tbody tr", timeout=20_000)
            page.screenshot(path=output / f"results-{theme}.png")
            page.locator("td.entry-title button").first.click()
            page.wait_for_selector(".details-list", timeout=20_000)
            page.screenshot(path=output / f"detail-{theme}.png")
            page.keyboard.press("Escape")
            page.goto(f"{BASE_URL}/ingest", wait_until="networkidle")
            page.wait_for_selector("table tbody tr", timeout=20_000)
            page.screenshot(path=output / f"ingest-{theme}.png")
            print(theme, "errors:", errors[:5])
            context.close()
        narrow = browser.new_context(viewport={"width": 390, "height": 800}, locale="ja-JP")
        page = narrow.new_page()
        page.goto(f"{BASE_URL}/?query=%E9%9F%B3%E6%A5%BD", wait_until="networkidle")
        page.wait_for_selector("table tbody tr", timeout=20_000)
        page.screenshot(path=output / "results-narrow.png")
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        print("narrow horizontal overflow:", overflow)
        browser.close()


if __name__ == "__main__":
    main()
