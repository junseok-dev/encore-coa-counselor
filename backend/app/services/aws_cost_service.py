from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import BillingDailyCostRecord, BillingSyncState


class AwsCostSyncError(RuntimeError):
    pass


def _next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _sync_payload(state: BillingSyncState, cached: bool) -> dict:
    return {
        "billing_month": state.billing_month,
        "provider": state.provider,
        "status": state.status,
        "message": state.message,
        "currency": state.currency,
        "exchange_rate_krw": state.exchange_rate_krw,
        "synced_at": state.synced_at,
        "cached": cached,
    }


def sync_aws_costs(db: Session, billing_month: str, force: bool = False) -> dict:
    settings = get_settings()
    try:
        month_start = datetime.strptime(billing_month, "%Y-%m").date().replace(day=1)
    except ValueError as exc:
        raise AwsCostSyncError("청구 월은 YYYY-MM 형식이어야 합니다.") from exc

    state = db.query(BillingSyncState).filter(BillingSyncState.billing_month == billing_month).first()
    now = datetime.now()
    if state and state.status == "success" and state.synced_at and not force:
        synced_at = state.synced_at.replace(tzinfo=None) if state.synced_at.tzinfo else state.synced_at
        is_closed_month = _next_month(month_start) <= date.today().replace(day=1)
        if is_closed_month or now - synced_at < timedelta(hours=24):
            return _sync_payload(state, cached=True)

    if state is None:
        state = BillingSyncState(billing_month=billing_month)
        db.add(state)
    state.provider = "aws_cost_explorer"
    state.currency = "USD"
    state.exchange_rate_krw = settings.aws_billing_usd_krw_rate

    if not settings.aws_billing_enabled:
        state.status = "not_configured"
        state.message = "AWS_BILLING_ENABLED=true와 Cost Explorer 조회 권한을 설정해 주세요."
        db.commit()
        raise AwsCostSyncError(state.message)

    month_end = _next_month(month_start)
    if month_start > date.today():
        state.status = "success"
        state.message = "아직 사용 내역이 발생하지 않은 미래 청구 월입니다."
        state.synced_at = now
        db.commit()
        return _sync_payload(state, cached=False)

    query_end = min(month_end, date.today() + timedelta(days=1))
    session_kwargs = {}
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        session_kwargs = {
            "aws_access_key_id": settings.aws_access_key_id,
            "aws_secret_access_key": settings.aws_secret_access_key,
        }

    try:
        import boto3

        client = boto3.session.Session(**session_kwargs).client("ce", region_name="us-east-1")
        request: dict = {
            "TimePeriod": {"Start": month_start.isoformat(), "End": query_end.isoformat()},
            "Granularity": "DAILY",
            "Metrics": ["UnblendedCost"],
            "GroupBy": [
                {"Type": "DIMENSION", "Key": "LINKED_ACCOUNT"},
                {"Type": "DIMENSION", "Key": "SERVICE"},
            ],
        }
        account_ids = [value.strip() for value in settings.aws_billing_account_ids.split(",") if value.strip()]
        if account_ids:
            request["Filter"] = {
                "Dimensions": {"Key": "LINKED_ACCOUNT", "Values": account_ids},
            }

        results = []
        while True:
            response = client.get_cost_and_usage(**request)
            results.extend(response.get("ResultsByTime", []))
            token = response.get("NextPageToken")
            if not token:
                break
            request["NextPageToken"] = token

        db.query(BillingDailyCostRecord).filter(
            BillingDailyCostRecord.usage_date >= month_start,
            BillingDailyCostRecord.usage_date < month_end,
            BillingDailyCostRecord.source == "aws_cost_explorer",
        ).delete(synchronize_session=False)

        imported_rows = 0
        total_usd = Decimal("0")
        rate = Decimal(str(settings.aws_billing_usd_krw_rate))
        for result in results:
            usage_date = datetime.strptime(result["TimePeriod"]["Start"], "%Y-%m-%d").date()
            for group in result.get("Groups", []):
                keys = group.get("Keys", [])
                if len(keys) < 2:
                    continue
                account_id, service_name = keys[0].strip(), keys[1].strip()
                metric = group.get("Metrics", {}).get("UnblendedCost", {})
                try:
                    amount_usd = Decimal(str(metric.get("Amount", "0")))
                except InvalidOperation:
                    continue
                if amount_usd == 0:
                    continue
                total_usd += amount_usd
                row = db.query(BillingDailyCostRecord).filter(
                    BillingDailyCostRecord.usage_date == usage_date,
                    BillingDailyCostRecord.account_id == account_id,
                    BillingDailyCostRecord.service_name == service_name,
                ).first()
                account_name = (
                    settings.aws_billing_account_name
                    if len(account_ids) == 1 and account_id == account_ids[0] and settings.aws_billing_account_name
                    else f"AWS 계정 {account_id}"
                )
                if row is None:
                    row = BillingDailyCostRecord(
                        usage_date=usage_date,
                        account_id=account_id,
                        account_name=account_name,
                        service_name=service_name,
                        amount_krw=0,
                    )
                    db.add(row)
                row.account_name = account_name
                row.amount_usd = float(amount_usd)
                row.exchange_rate_krw = float(rate)
                row.amount_krw = round(float(amount_usd * rate))
                row.source = "aws_cost_explorer"
                imported_rows += 1

        state.status = "success"
        state.message = f"AWS Cost Explorer에서 {imported_rows}개 비용 항목을 동기화했습니다."
        state.synced_at = now
        db.commit()
        payload = _sync_payload(state, cached=False)
        payload.update({"imported_rows": imported_rows, "total_usd": float(total_usd)})
        return payload
    except AwsCostSyncError:
        raise
    except Exception as exc:
        db.rollback()
        state = db.query(BillingSyncState).filter(BillingSyncState.billing_month == billing_month).first()
        if state is None:
            state = BillingSyncState(billing_month=billing_month)
            db.add(state)
        state.status = "failed"
        state.message = f"AWS 비용 동기화 실패: {exc}"
        state.exchange_rate_krw = settings.aws_billing_usd_krw_rate
        db.commit()
        raise AwsCostSyncError(state.message) from exc
