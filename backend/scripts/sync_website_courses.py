"""공식 홈페이지 과정 스냅샷을 즉시 갱신하는 운영용 스크립트."""

from app.services.website_course_service import refresh_course_snapshot


if __name__ == "__main__":
    snapshot = refresh_course_snapshot(force=True)
    if not snapshot:
        raise SystemExit("동기화에 실패했고 기존 정상 스냅샷도 없습니다.")
    print(
        "동기화 완료:",
        snapshot["fetched_at"],
        snapshot["content_hash"][:12],
        f"{len(snapshot['courses'])}개 과정",
    )
