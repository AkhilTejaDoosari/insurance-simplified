"""Misbehaving readers for sandbox tests (imported inside the child process)."""

import os
import signal
import time


class Crash:
    def read(self, pdf: bytes) -> None:
        os.kill(os.getpid(), signal.SIGSEGV)


class Hang:
    def read(self, pdf: bytes) -> None:
        time.sleep(60)


class DieAtImport:
    """Simulates a reader whose native library kills the process before any reply."""

    def read(self, pdf: bytes) -> None:
        os._exit(139)
