import argparse
import json
import mimetypes
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload


SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Upload PocketLab CSV exports from a local folder into a Google Drive folder."
        )
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Folder where PocketLab CSV exports are saved.",
    )
    parser.add_argument(
        "--drive-folder-id",
        required=True,
        help="Destination Google Drive folder ID.",
    )
    parser.add_argument(
        "--credentials",
        type=Path,
        default=Path("credentials.json"),
        help="Path to the Google OAuth client credentials JSON file.",
    )
    parser.add_argument(
        "--token",
        type=Path,
        default=Path("token.json"),
        help="Path to the cached Google OAuth token file.",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=Path(".upload-state.json"),
        help="Path to the local file upload state cache.",
    )
    parser.add_argument(
        "--archive-dir",
        type=Path,
        help="Optional folder to move files into after a successful upload.",
    )
    parser.add_argument(
        "--pattern",
        default="*.csv",
        help="Glob pattern for PocketLab export files. Default: *.csv",
    )
    parser.add_argument(
        "--poll-interval",
        type=int,
        default=30,
        help="Seconds between folder scans in watch mode. Default: 30",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Keep scanning for newly exported files.",
    )
    parser.add_argument(
        "--upload-existing",
        action="store_true",
        help="Upload all matching files in the source folder on startup.",
    )
    return parser.parse_args()


def ensure_directory(path: Path, label: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{label} does not exist: {path}")
    if not path.is_dir():
        raise NotADirectoryError(f"{label} is not a directory: {path}")


def load_state(path: Path) -> Dict[str, Dict[str, str]]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise ValueError(f"State file is not valid JSON: {path}")


def save_state(path: Path, state: Dict[str, Dict[str, str]]) -> None:
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def build_file_signature(file_path: Path) -> str:
    stat = file_path.stat()
    return f"{stat.st_size}:{int(stat.st_mtime)}"


def list_candidate_files(source_dir: Path, pattern: str) -> List[Path]:
    return sorted(path for path in source_dir.glob(pattern) if path.is_file())


def get_credentials(credentials_path: Path, token_path: Path) -> Credentials:
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    elif not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
        creds = flow.run_local_server(port=0)

    token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def build_drive_service(credentials_path: Path, token_path: Path):
    creds = get_credentials(credentials_path, token_path)
    return build("drive", "v3", credentials=creds)


def upload_file(service, file_path: Path, drive_folder_id: str) -> str:
    mime_type = mimetypes.guess_type(str(file_path))[0] or "text/csv"
    metadata = {
        "name": file_path.name,
        "parents": [drive_folder_id],
    }
    media = MediaFileUpload(str(file_path), mimetype=mime_type, resumable=True)
    created = (
        service.files()
        .create(
            body=metadata,
            media_body=media,
            fields="id, name, webViewLink",
        )
        .execute()
    )
    print(
        f"Uploaded {created['name']} -> Google Drive file {created['id']}",
        flush=True,
    )
    return created["id"]


def move_to_archive(file_path: Path, archive_dir: Path) -> Path:
    archive_dir.mkdir(parents=True, exist_ok=True)
    destination = archive_dir / file_path.name
    if destination.exists():
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = archive_dir / f"{file_path.stem}_{timestamp}{file_path.suffix}"
    file_path.rename(destination)
    return destination


def pending_files(
    files: Iterable[Path],
    state: Dict[str, Dict[str, str]],
    include_existing: bool,
) -> List[Path]:
    results: List[Path] = []
    for file_path in files:
        signature = build_file_signature(file_path)
        known = state.get(str(file_path.resolve()))
        if known and known.get("signature") == signature:
            continue
        if not include_existing and not known:
            continue
        results.append(file_path)
    return results


def record_upload(
    state: Dict[str, Dict[str, str]],
    original_path: Path,
    uploaded_path: Path,
    drive_file_id: str,
) -> None:
    state[str(original_path.resolve())] = {
        "signature": build_file_signature(uploaded_path),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "drive_file_id": drive_file_id,
        "final_path": str(uploaded_path.resolve()),
    }


def process_once(args: argparse.Namespace, service, state: Dict[str, Dict[str, str]]) -> int:
    files = list_candidate_files(args.source_dir, args.pattern)
    to_upload = pending_files(files, state, include_existing=args.upload_existing)

    if not to_upload:
        print("No new PocketLab files found.", flush=True)
        return 0

    uploaded_count = 0
    for file_path in to_upload:
        drive_file_id = upload_file(service, file_path, args.drive_folder_id)
        final_path = file_path
        if args.archive_dir:
            final_path = move_to_archive(file_path, args.archive_dir)
            print(f"Archived to {final_path}", flush=True)
        record_upload(state, file_path, final_path, drive_file_id)
        uploaded_count += 1

    save_state(args.state_file, state)
    return uploaded_count


def main() -> int:
    args = parse_args()

    try:
        ensure_directory(args.source_dir, "Source directory")
        if args.archive_dir:
            args.archive_dir.mkdir(parents=True, exist_ok=True)
        if not args.credentials.exists():
            raise FileNotFoundError(
                "Google OAuth client file not found. Provide --credentials credentials.json."
            )
        state = load_state(args.state_file)
        service = build_drive_service(args.credentials, args.token)
    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except HttpError as exc:
        print(f"Google Drive API error while authenticating: {exc}", file=sys.stderr)
        return 3

    try:
        process_once(args, service, state)
        args.upload_existing = True
        while args.watch:
            time.sleep(args.poll_interval)
            process_once(args, service, state)
    except KeyboardInterrupt:
        print("Stopped by user.", flush=True)
        return 0
    except HttpError as exc:
        print(f"Google Drive API error: {exc}", file=sys.stderr)
        return 4

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
