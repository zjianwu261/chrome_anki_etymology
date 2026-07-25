#!/usr/bin/env python3
import json
import platform
import re
import struct
import subprocess
import sys
import time
from shutil import which

POLL_INTERVAL_SECONDS = 0.8
DEDUP_SECONDS = 30
WORD_PATTERN = re.compile(r"^[A-Za-z]+(?:['-][A-Za-z]+)*$")


def send_message(payload):
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def normalize_word(raw_text):
    if raw_text is None:
        return ""

    cleaned = (
        str(raw_text)
        .strip()
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )
    cleaned = re.sub(r"^[^A-Za-z]+|[^A-Za-z'-]+$", "", cleaned)

    if not cleaned or len(cleaned) < 2 or len(cleaned) > 28:
        return ""
    if not WORD_PATTERN.fullmatch(cleaned):
        return ""
    return cleaned


def read_clipboard_text():
    system = platform.system()

    if system == "Darwin":
        return run_command(["pbpaste"])

    if system == "Windows":
        return run_command(
            ["powershell", "-NoProfile", "-Command", "Get-Clipboard"],
            encoding="utf-8",
        )

    if system == "Linux":
        for command in (
            ["wl-paste", "-n"],
            ["xclip", "-o", "-selection", "clipboard"],
            ["xsel", "--clipboard", "--output"],
        ):
            if which(command[0]):
                return run_command(command)

    return None


def run_command(command, encoding="utf-8"):
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding=encoding,
            check=False,
        )
    except Exception:
        return None

    if completed.returncode != 0:
        return None
    return completed.stdout


def main():
    last_raw = None
    last_sent_word = ""
    last_sent_at = 0.0

    send_message({"type": "HOST_STATUS", "status": "本地剪贴板桥接已启动"})

    while True:
        raw = read_clipboard_text()
        if raw is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        if raw == last_raw:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        last_raw = raw
        word = normalize_word(raw)
        now = time.time()

        if not word:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        if word.lower() == last_sent_word and now - last_sent_at < DEDUP_SECONDS:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        last_sent_word = word.lower()
        last_sent_at = now

        try:
            send_message({"type": "CLIPBOARD_WORD", "word": word})
        except BrokenPipeError:
            return

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        pass
