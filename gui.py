"""Simple tkinter GUI for Identity Tree Mapper."""

import threading
import logging
import tkinter as tk
from tkinter import ttk, scrolledtext, filedialog

from .config import Config
from .api_client import ApiClient
from .database import Database
from .phase1_crawler import run_phase1
from .phase2_crawler import run_phase2


class TextHandler(logging.Handler):
    """Logging handler that writes to a tkinter Text widget."""

    def __init__(self, text_widget):
        super().__init__()
        self.text_widget = text_widget

    def emit(self, record):
        msg = self.format(record) + "\n"
        self.text_widget.after(0, self._append, msg)

    def _append(self, msg):
        self.text_widget.configure(state="normal")
        self.text_widget.insert(tk.END, msg)
        self.text_widget.see(tk.END)
        self.text_widget.configure(state="disabled")


class MapperGUI:
    def __init__(self, config: Config):
        self.config = config
        self.running = False
        self.thread = None

        self.root = tk.Tk()
        self.root.title("Identity Tree Mapper")
        self.root.geometry("800x600")
        self._build_ui()

    def _build_ui(self):
        # Config frame
        cfg = ttk.LabelFrame(self.root, text="Configuration", padding=10)
        cfg.pack(fill="x", padx=10, pady=5)

        row = 0
        ttk.Label(cfg, text="API Endpoint:").grid(row=row, column=0, sticky="w")
        self.endpoint_var = tk.StringVar(value=self.config.endpoint)
        ttk.Entry(cfg, textvariable=self.endpoint_var, width=50).grid(row=row, column=1, padx=5)

        row += 1
        ttk.Label(cfg, text="Source DB:").grid(row=row, column=0, sticky="w")
        self.source_var = tk.StringVar(value=self.config.source_db)
        src_frame = ttk.Frame(cfg)
        src_frame.grid(row=row, column=1, sticky="ew", padx=5)
        ttk.Entry(src_frame, textvariable=self.source_var, width=40).pack(side="left", fill="x", expand=True)
        ttk.Button(src_frame, text="Browse", command=self._browse_source).pack(side="right")

        row += 1
        ttk.Label(cfg, text="Output DB:").grid(row=row, column=0, sticky="w")
        self.output_var = tk.StringVar(value=self.config.output_db)
        out_frame = ttk.Frame(cfg)
        out_frame.grid(row=row, column=1, sticky="ew", padx=5)
        ttk.Entry(out_frame, textvariable=self.output_var, width=40).pack(side="left", fill="x", expand=True)
        ttk.Button(out_frame, text="Browse", command=self._browse_output).pack(side="right")

        row += 1
        ttk.Label(cfg, text="Rate Limit (req/s):").grid(row=row, column=0, sticky="w")
        self.rate_var = tk.StringVar(value=str(self.config.rate_limit))
        ttk.Entry(cfg, textvariable=self.rate_var, width=10).grid(row=row, column=1, sticky="w", padx=5)

        row += 1
        ttk.Label(cfg, text="Phase:").grid(row=row, column=0, sticky="w")
        self.phase_var = tk.StringVar(value="all")
        phase_frame = ttk.Frame(cfg)
        phase_frame.grid(row=row, column=1, sticky="w", padx=5)
        for val, label in [("1", "Phase 1"), ("2", "Phase 2"), ("all", "Both")]:
            ttk.Radiobutton(phase_frame, text=label, variable=self.phase_var, value=val).pack(side="left", padx=5)

        # Buttons
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill="x", padx=10, pady=5)

        self.start_btn = ttk.Button(btn_frame, text="Start", command=self._start)
        self.start_btn.pack(side="left", padx=5)

        self.stop_btn = ttk.Button(btn_frame, text="Stop", command=self._stop, state="disabled")
        self.stop_btn.pack(side="left", padx=5)

        self.stats_btn = ttk.Button(btn_frame, text="Show Stats", command=self._show_stats)
        self.stats_btn.pack(side="left", padx=5)

        # Log output
        log_frame = ttk.LabelFrame(self.root, text="Log Output", padding=5)
        log_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.log_text = scrolledtext.ScrolledText(log_frame, state="disabled", wrap="word")
        self.log_text.pack(fill="both", expand=True)

        # Set up logging to text widget
        handler = TextHandler(self.log_text)
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S"))
        logging.getLogger().addHandler(handler)
        logging.getLogger().setLevel(logging.INFO)

    def _browse_source(self):
        path = filedialog.askopenfilename(filetypes=[("SQLite DB", "*.db"), ("All", "*.*")])
        if path:
            self.source_var.set(path)

    def _browse_output(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".db", filetypes=[("SQLite DB", "*.db"), ("All", "*.*")]
        )
        if path:
            self.output_var.set(path)

    def _start(self):
        if self.running:
            return

        self.config.endpoint = self.endpoint_var.get()
        self.config.source_db = self.source_var.get()
        self.config.output_db = self.output_var.get()
        self.config.rate_limit = float(self.rate_var.get())
        self.config.phase = self.phase_var.get()

        self.running = True
        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")

        self.thread = threading.Thread(target=self._run_crawl, daemon=True)
        self.thread.start()

    def _run_crawl(self):
        log = logging.getLogger("identity_tree_mapper")
        try:
            db = Database(self.config.output_db)
            api = ApiClient(
                self.config.endpoint,
                rate_limit=self.config.rate_limit,
                max_retries=self.config.max_retries,
            )

            if self.config.phase in ("1", "all"):
                run_phase1(db, api, self.config.source_db, resume=self.config.resume)

            if self.running and self.config.phase in ("2", "all"):
                run_phase2(db, api)

            stats = db.get_stats()
            log.info("=== Final Statistics ===")
            for k, v in stats.items():
                log.info("  %s: %s", k, v)

            db.close()
        except Exception as e:
            log.error("Crawl error: %s", e)
        finally:
            self.running = False
            self.root.after(0, self._reset_buttons)

    def _stop(self):
        self.running = False
        logging.getLogger().info("Stop requested — will halt after current operation")

    def _reset_buttons(self):
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")

    def _show_stats(self):
        try:
            db = Database(self.output_var.get())
            stats = db.get_stats()
            db.close()

            win = tk.Toplevel(self.root)
            win.title("Database Statistics")
            win.geometry("400x300")

            text = scrolledtext.ScrolledText(win, wrap="word")
            text.pack(fill="both", expand=True, padx=5, pady=5)

            for k, v in stats.items():
                text.insert(tk.END, f"{k}: {v}\n")

        except Exception as e:
            logging.getLogger().error("Could not read stats: %s", e)

    def run(self):
        self.root.mainloop()


def run_gui(config: Config):
    gui = MapperGUI(config)
    gui.run()
