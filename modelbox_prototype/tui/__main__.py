"""Entry point: python -m tui"""

from tui.app import ModelBoxApp


def main() -> None:
    app = ModelBoxApp()
    app.run()


if __name__ == "__main__":
    main()
