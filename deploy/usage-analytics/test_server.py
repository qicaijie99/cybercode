import base64
import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlencode

from server import (
    ASSET_CONTENT_TYPES,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    AnalyticsStore,
    GeoLocation,
    GeoResolver,
    PayloadError,
    UsageRequestHandler,
    cookie_value,
    create_session_token,
    extract_public_ip,
    session_secret_from_password,
    trusted_client_ip,
    validate_payload,
    verify_session_token,
)


def payload(installation_id: str, version: str = "1.2.3", surface: str = "desktop"):
    return {
        "schemaVersion": 1,
        "installationId": installation_id,
        "version": version,
        "platform": "win32",
        "arch": "x64",
        "surface": surface,
    }


class UsageAnalyticsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database_path = os.path.join(self.temp.name, "usage.sqlite3")
        self.store = AnalyticsStore(self.database_path)

    def tearDown(self):
        self.temp.cleanup()

    def test_daily_and_cumulative_counts_are_deduplicated(self):
        first = validate_payload(payload("a" * 64))
        second = validate_payload(payload("b" * 64, surface="cli"))
        self.store.record(first, datetime(2026, 7, 17, 2, 0, tzinfo=timezone.utc))
        self.store.record(first, datetime(2026, 7, 18, 2, 0, tzinfo=timezone.utc))
        self.store.record(first, datetime(2026, 7, 18, 3, 0, tzinfo=timezone.utc))
        self.store.record(second, datetime(2026, 7, 18, 4, 0, tzinfo=timezone.utc))

        result = self.store.summary(datetime(2026, 7, 18, 8, 0, tzinfo=timezone.utc))
        self.assertEqual(result["totalUsers"], 2)
        self.assertEqual(result["todayActive"], 2)
        self.assertEqual(result["newToday"], 1)
        self.assertEqual(result["returningToday"], 1)
        self.assertEqual(result["active7d"], 2)
        self.assertEqual(result["active30d"], 2)
        self.assertEqual(result["yesterdayActive"], 1)
        self.assertEqual(result["newYesterday"], 1)
        self.assertEqual(result["new7d"], 2)
        self.assertEqual(result["newPrevious7d"], 0)
        self.assertEqual(result["new30d"], 2)
        self.assertIsNone(result["new7dGrowthRate"])
        self.assertEqual(result["dauMauRate"], 100.0)
        self.assertEqual(result["wauMauRate"], 100.0)
        self.assertEqual(result["returningRate"], 50.0)
        self.assertEqual(result["d1CohortSize"], 1)
        self.assertEqual(result["d1RetainedUsers"], 1)
        self.assertEqual(result["d1RetentionRate"], 100.0)
        self.assertIsNone(result["d7RetentionRate"])
        self.assertEqual(
            result["trend"][-1],
            {"day": "2026-07-18", "active": 2, "new": 1, "cumulative": 2},
        )
        self.assertEqual(result["trend"][-1]["active"], result["todayActive"])
        self.assertEqual(result["trend"][-1]["new"], result["newToday"])
        self.assertEqual(result["trend"][-1]["cumulative"], result["totalUsers"])
        self.assertEqual(result["trend"][-2]["cumulative"], 1)
        for row in result["trend"]:
            self.assertLessEqual(row["new"], row["active"])
            self.assertLessEqual(row["active"], row["cumulative"])

    def test_growth_periods_and_retention_use_mature_cohorts(self):
        now = datetime(2026, 7, 18, 8, 0, tzinfo=timezone.utc)
        yesterday = datetime(2026, 7, 17, 8, 0, tzinfo=timezone.utc)
        seven_days_ago = datetime(2026, 7, 11, 8, 0, tzinfo=timezone.utc)

        d1_retained = validate_payload(payload("1" * 64))
        d1_lost = validate_payload(payload("2" * 64))
        d7_retained = validate_payload(payload("3" * 64))
        d7_lost = validate_payload(payload("4" * 64))
        self.store.record(d1_retained, yesterday)
        self.store.record(d1_retained, now)
        self.store.record(d1_lost, yesterday)
        self.store.record(d7_retained, seven_days_ago)
        self.store.record(d7_retained, now)
        self.store.record(d7_lost, seven_days_ago)

        result = self.store.summary(now)
        self.assertEqual(result["new7d"], 2)
        self.assertEqual(result["newPrevious7d"], 2)
        self.assertEqual(result["new7dGrowthRate"], 0.0)
        self.assertEqual(result["new30d"], 4)
        self.assertEqual(result["d1CohortSize"], 2)
        self.assertEqual(result["d1RetainedUsers"], 1)
        self.assertEqual(result["d1RetentionRate"], 50.0)
        self.assertEqual(result["d7CohortSize"], 2)
        self.assertEqual(result["d7RetainedUsers"], 1)
        self.assertEqual(result["d7RetentionRate"], 50.0)
        self.assertEqual(result["dauMauRate"], 50.0)
        self.assertEqual(result["wauMauRate"], 75.0)
        self.assertEqual(result["returningRate"], 100.0)

    def test_china_day_boundary_keeps_cards_and_trend_aligned(self):
        returning_user = validate_payload(payload("5" * 64))
        new_user = validate_payload(payload("6" * 64))
        before_midnight = datetime(2026, 7, 18, 15, 59, tzinfo=timezone.utc)
        after_midnight = datetime(2026, 7, 18, 16, 1, tzinfo=timezone.utc)

        self.store.record(returning_user, before_midnight)
        self.store.record(returning_user, after_midnight)
        self.store.record(new_user, after_midnight)
        self.store.record(new_user, after_midnight)

        result = self.store.summary(after_midnight)
        self.assertEqual(result["today"], "2026-07-19")
        self.assertEqual(result["totalUsers"], 2)
        self.assertEqual(result["todayActive"], 2)
        self.assertEqual(result["newToday"], 1)
        self.assertEqual(result["returningToday"], 1)
        self.assertEqual(result["yesterdayActive"], 1)
        self.assertEqual(result["trend"][-1]["day"], result["today"])
        self.assertEqual(result["trend"][-1]["active"], result["todayActive"])
        self.assertEqual(result["trend"][-1]["new"], result["newToday"])
        self.assertEqual(result["trend"][-1]["cumulative"], result["totalUsers"])

    def test_schema_contains_no_personal_or_network_identity_columns(self):
        with sqlite3.connect(self.database_path) as connection:
            columns = {
                row[1]
                for table in ("installations", "daily_activity")
                for row in connection.execute("PRAGMA table_info({0})".format(table))
            }
        for forbidden in ("ip", "email", "username", "hostname", "project", "prompt"):
            self.assertNotIn(forbidden, columns)

    def test_payload_is_strict_and_rejects_extra_data(self):
        value = payload("c" * 64)
        value["projectPath"] = "/private/project"
        with self.assertRaises(PayloadError):
            validate_payload(value)

        with self.assertRaises(PayloadError):
            validate_payload(payload("not-a-valid-id"))

    def test_location_summary_is_aggregated_without_storing_an_ip(self):
        guangdong = GeoLocation("CN", "中国", "广东省")
        california = GeoLocation("US", "美国", "California")
        first = validate_payload(payload("d" * 64))
        second = validate_payload(payload("e" * 64))
        third = validate_payload(payload("f" * 64))
        now = datetime(2026, 7, 18, 8, 0, tzinfo=timezone.utc)

        self.store.record(first, now, guangdong)
        self.store.record(second, now, guangdong)
        self.store.record(third, now, california)
        self.store.record(first, now, GeoLocation())

        result = self.store.summary(now)
        self.assertEqual(result["locatedUsers"], 3)
        self.assertEqual(result["unlocatedUsers"], 0)
        self.assertEqual(
            result["countries"],
            [
                {"countryCode": "CN", "countryName": "中国", "count": 2},
                {"countryCode": "US", "countryName": "美国", "count": 1},
            ],
        )
        self.assertEqual(result["regions"][0]["regionName"], "广东省")
        self.assertEqual(result["regions"][0]["count"], 2)
        self.assertEqual(result["chinaUsers"], 2)
        self.assertEqual(result["chinaLocatedUsers"], 2)
        self.assertEqual(result["chinaUnlocatedUsers"], 0)
        self.assertEqual(
            result["chinaProvinces"],
            [{"provinceName": "广东省", "count": 2}],
        )

    def test_china_province_summary_covers_mainland_hong_kong_macao_and_taiwan(self):
        now = datetime(2026, 7, 18, 8, 0, tzinfo=timezone.utc)
        locations = [
            GeoLocation("CN", "中国", "广东省"),
            GeoLocation("CN", "中国", "广东省"),
            GeoLocation("CN", "中国", "北京市"),
            GeoLocation("CN", "中国", ""),
            GeoLocation("HK", "中国香港", ""),
            GeoLocation("MO", "中国澳门", ""),
            GeoLocation("TW", "中国台湾", ""),
            GeoLocation("US", "美国", "California"),
        ]
        for index, location in enumerate(locations):
            installation_id = format(index + 16, "x") * 64
            self.store.record(
                validate_payload(payload(installation_id[:64])),
                now,
                location,
            )

        result = self.store.summary(now)
        self.assertEqual(result["chinaUsers"], 7)
        self.assertEqual(result["chinaLocatedUsers"], 6)
        self.assertEqual(result["chinaUnlocatedUsers"], 1)
        self.assertEqual(
            result["chinaProvinces"],
            [
                {"provinceName": "广东省", "count": 2},
                {"provinceName": "北京市", "count": 1},
                {"provinceName": "台湾省", "count": 1},
                {"provinceName": "澳门特别行政区", "count": 1},
                {"provinceName": "香港特别行政区", "count": 1},
            ],
        )

    def test_existing_database_is_migrated_without_losing_users(self):
        legacy_path = os.path.join(self.temp.name, "legacy.sqlite3")
        with sqlite3.connect(legacy_path) as connection:
            connection.executescript(
                """
                CREATE TABLE installations (
                    installation_id TEXT PRIMARY KEY,
                    first_seen_at TEXT NOT NULL,
                    first_seen_day TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    last_seen_day TEXT NOT NULL,
                    version TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    arch TEXT NOT NULL,
                    surface TEXT NOT NULL
                );
                CREATE TABLE daily_activity (
                    day TEXT NOT NULL,
                    installation_id TEXT NOT NULL,
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    version TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    arch TEXT NOT NULL,
                    surface TEXT NOT NULL,
                    PRIMARY KEY (day, installation_id)
                );
                INSERT INTO installations VALUES (
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    '2026-07-18T00:00:00+00:00', '2026-07-18',
                    '2026-07-18T00:00:00+00:00', '2026-07-18',
                    '1.2.3', 'win32', 'x64', 'desktop'
                );
                """
            )

        migrated = AnalyticsStore(legacy_path)
        result = migrated.summary(datetime(2026, 7, 18, 8, 0, tzinfo=timezone.utc))
        self.assertEqual(result["totalUsers"], 1)
        self.assertEqual(result["locatedUsers"], 0)
        with sqlite3.connect(legacy_path) as connection:
            columns = {
                row[1]
                for row in connection.execute("PRAGMA table_info(installations)")
            }
        self.assertTrue({"country_code", "country_name", "region_name"} <= columns)

    def test_ip_is_only_accepted_from_the_local_reverse_proxy(self):
        self.assertEqual(extract_public_ip("8.8.8.8"), "8.8.8.8")
        self.assertIsNone(extract_public_ip("127.0.0.1"))
        self.assertIsNone(extract_public_ip("8.8.8.8, 1.1.1.1"))
        self.assertEqual(trusted_client_ip("8.8.8.8", "127.0.0.1"), "8.8.8.8")
        self.assertIsNone(trusted_client_ip("8.8.8.8", "203.0.113.20"))

    def test_signed_session_rejects_tampering_and_expiry(self):
        self.assertEqual(SESSION_TTL_SECONDS, 31 * 24 * 60 * 60)
        secret = session_secret_from_password("a-long-admin-password")
        token = create_session_token("admin", secret, now=1_000)
        self.assertTrue(verify_session_token(token, "admin", secret, now=1_000))
        self.assertTrue(
            verify_session_token(
                token,
                "admin",
                secret,
                now=1_000 + SESSION_TTL_SECONDS,
            )
        )
        self.assertFalse(
            verify_session_token(
                token,
                "admin",
                secret,
                now=1_001 + SESSION_TTL_SECONDS,
            )
        )
        payload_value, signature_value = token.split(".", 1)
        replacement = "A" if signature_value[0] != "A" else "B"
        tampered = payload_value + "." + replacement + signature_value[1:]
        self.assertFalse(verify_session_token(tampered, "admin", secret, now=1_000))
        self.assertFalse(verify_session_token(token, "other", secret, now=1_000))
        self.assertEqual(
            cookie_value("theme=dark; {0}=abc".format(SESSION_COOKIE_NAME), SESSION_COOKIE_NAME),
            "abc",
        )

    def test_web_login_uses_cookie_without_basic_auth_challenge(self):
        password = "cybercode-test-password"
        UsageRequestHandler.store = self.store
        UsageRequestHandler.admin_username = "cybercode"
        UsageRequestHandler.admin_password = password
        UsageRequestHandler.session_secret = session_secret_from_password(password)
        UsageRequestHandler.dashboard_html = b"<!doctype html><title>dashboard</title>"
        UsageRequestHandler.login_html = (
            Path(__file__).parent / "login.html"
        ).read_bytes()
        UsageRequestHandler.static_assets = {}
        server = ThreadingHTTPServer(("127.0.0.1", 0), UsageRequestHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(method, path, body=None, headers=None):
            connection = http.client.HTTPConnection(
                "127.0.0.1",
                server.server_address[1],
                timeout=3,
            )
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            result = (
                response.status,
                dict(response.getheaders()),
                response.read(),
            )
            connection.close()
            return result

        try:
            status, headers, _ = request("GET", "/cybercode-stats")
            self.assertEqual(status, 302)
            self.assertEqual(headers["Location"], "/cybercode-stats/login")
            self.assertNotIn("WWW-Authenticate", headers)

            status, headers, body = request("HEAD", "/cybercode-stats")
            self.assertEqual(status, 302)
            self.assertEqual(headers["Location"], "/cybercode-stats/login")
            self.assertEqual(body, b"")

            status, headers, body = request("GET", "/cybercode-stats/login")
            self.assertEqual(status, 200)
            self.assertIn("CyberCode".encode(), body)
            self.assertIn("31 天免登录".encode(), body)
            self.assertNotIn("12 小时".encode(), body)
            self.assertNotIn(b"__LOGIN_ERROR_MESSAGE__", body)
            self.assertNotIn("WWW-Authenticate", headers)

            invalid_body = urlencode(
                {"username": "用户", "password": "wrong"}
            ).encode()
            status, headers, body = request(
                "POST",
                "/api/cybercode-usage/login",
                invalid_body,
                {"Content-Type": "application/x-www-form-urlencoded"},
            )
            self.assertEqual(status, 303)
            self.assertEqual(headers["Location"], "/cybercode-stats/login?error=1")
            self.assertNotIn("WWW-Authenticate", headers)
            status, headers, body = request(
                "GET",
                "/cybercode-stats/login?error=1",
            )
            self.assertEqual(status, 200)
            self.assertIn("不正确".encode(), body)
            self.assertNotIn("WWW-Authenticate", headers)

            login_body = urlencode(
                {"username": "cybercode", "password": password}
            ).encode()
            status, headers, _ = request(
                "POST",
                "/api/cybercode-usage/login",
                login_body,
                {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-Forwarded-Proto": "https",
                },
            )
            self.assertEqual(status, 303)
            session_cookie = headers["Set-Cookie"]
            self.assertIn("HttpOnly", session_cookie)
            self.assertIn("SameSite=Strict", session_cookie)
            self.assertIn("Secure", session_cookie)
            self.assertIn(
                "Max-Age={0}".format(SESSION_TTL_SECONDS),
                session_cookie,
            )
            cookie_header = session_cookie.split(";", 1)[0]

            status, _, body = request(
                "GET",
                "/cybercode-stats",
                headers={"Cookie": cookie_header},
            )
            self.assertEqual(status, 200)
            self.assertIn(b"dashboard", body)

            status, headers, body = request(
                "HEAD",
                "/cybercode-stats",
                headers={"Cookie": cookie_header},
            )
            self.assertEqual(status, 200)
            self.assertEqual(headers["Content-Length"], str(len(b"<!doctype html><title>dashboard</title>")))
            self.assertEqual(body, b"")

            status, _, _ = request(
                "GET",
                "/api/cybercode-usage/summary",
                headers={"Cookie": cookie_header},
            )
            self.assertEqual(status, 200)

            class FailingSummaryStore:
                def summary(self):
                    raise sqlite3.OperationalError("database is temporarily busy")

            UsageRequestHandler.store = FailingSummaryStore()
            status, _, body = request(
                "GET",
                "/api/cybercode-usage/summary",
                headers={"Cookie": cookie_header},
            )
            self.assertEqual(status, 503)
            self.assertEqual(
                json.loads(body),
                {"error": "Storage unavailable"},
            )
            UsageRequestHandler.store = self.store

            basic = base64.b64encode(
                "cybercode:{0}".format(password).encode()
            ).decode()
            status, _, _ = request(
                "GET",
                "/cybercode-stats",
                headers={"Authorization": "Basic " + basic},
            )
            self.assertEqual(status, 200)

            status, headers, _ = request(
                "POST",
                "/api/cybercode-usage/logout",
                headers={"Cookie": cookie_header},
            )
            self.assertEqual(status, 303)
            self.assertIn("Max-Age=0", headers["Set-Cookie"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_offline_resolver_keeps_only_country_and_subdivision(self):
        class FakeReader:
            def get(self, _address):
                return {
                    "country": {
                        "iso_code": "CN",
                        "names": {"zh-CN": "中国", "en": "China"},
                    },
                    "subdivisions": [
                        {"iso_code": "44", "names": {"en": "Unknown alias"}}
                    ],
                    "city": {"names": {"zh-CN": "深圳市"}},
                    "location": {"latitude": 22.5, "longitude": 114.0},
                }

        location = GeoResolver("unused", reader=FakeReader()).lookup("8.8.8.8")
        self.assertEqual(location, GeoLocation("CN", "中国", "广东省"))
        self.assertFalse(hasattr(location, "city"))
        self.assertFalse(hasattr(location, "latitude"))

        class BrokenReader:
            def get(self, _address):
                raise RuntimeError("corrupted database")

        self.assertEqual(
            GeoResolver("unused", reader=BrokenReader()).lookup("8.8.8.8"),
            GeoLocation(),
        )

    def test_dashboard_dependencies_are_local_and_available(self):
        root = Path(__file__).parent
        dashboard = (root / "dashboard.html").read_text(encoding="utf-8")
        for asset_name in ASSET_CONTENT_TYPES:
            self.assertTrue((root / "assets" / asset_name).is_file(), asset_name)
        self.assertNotIn("https://cdn.", dashboard)
        self.assertIn("/cybercode-stats/assets/gsap.min.js", dashboard)
        self.assertIn("/cybercode-stats/assets/satoshi-regular.woff2", dashboard)
        self.assertIn("/cybercode-stats/assets/china.geojson", dashboard)
        self.assertIn('id="heroTotalUsers"', dashboard)
        self.assertIn("Number(data.totalUsers || 0)", dashboard)
        self.assertIn("projection: chinaProjection", dashboard)
        self.assertIn("chinaProvinceNames.map", dashboard)
        self.assertIn("formatter.format(value)", dashboard)
        self.assertIn("color: '#ffffff'", dashboard)
        self.assertIn("fontWeight: 700", dashboard)
        self.assertIn("provinceLabelOffset(name, isCompact)", dashboard)
        self.assertIn("香港特别行政区: [26, 2]", dashboard)
        self.assertNotIn('class="china-map-panel media-reveal"', dashboard)
        self.assertNotIn('class="map-panel media-reveal"', dashboard)
        self.assertLess(
            dashboard.index('id="chinaProvinceMap"'),
            dashboard.index('id="chart"'),
        )
        self.assertLess(
            dashboard.index('id="chart"'),
            dashboard.index('id="geoMap"'),
        )
        self.assertIn("05 / 全球分布", dashboard)
        self.assertIn("06 / 构成观察", dashboard)
        self.assertIn("name: '日活用户'", dashboard)
        self.assertIn("name: '新增用户'", dashboard)
        self.assertIn("name: '累计用户'", dashboard)
        self.assertIn("position: 'left'", dashboard)
        self.assertNotIn("日活用户（左轴）", dashboard)
        self.assertNotIn("新增用户（左轴）", dashboard)
        self.assertNotIn("累计用户（右轴）", dashboard)
        self.assertIn("function trendSeries(rows, field)", dashboard)
        self.assertIn("function niceAxisMax(value)", dashboard)
        self.assertIn("const activeSeries = trendSeries(rows, 'active')", dashboard)
        self.assertIn("const newSeries = trendSeries(rows, 'new')", dashboard)
        self.assertIn("const cumulativeSeries = trendSeries(rows, 'cumulative')", dashboard)
        self.assertIn(
            "const axisMax = niceAxisMax(Math.max(...cumulativeSeries, ...activeSeries, ...newSeries, 1))",
            dashboard,
        )
        self.assertIn("max: axisMax", dashboard)
        self.assertIn("name: compact ? '' : '用户数'", dashboard)
        self.assertIn("tooltipPointValue(point)", dashboard)
        self.assertGreaterEqual(dashboard.count("yAxisIndex: 0"), 3)
        self.assertNotIn("yAxisIndex: 1", dashboard)
        self.assertGreaterEqual(dashboard.count("smooth: false"), 3)
        self.assertIn("validateSummary(await response.json())", dashboard)
        self.assertIn("escapeHtml(point.seriesName)", dashboard)
        self.assertIn("setTrend(previousSummary.trend || [], false)", dashboard)
        self.assertIn(
            "setChinaGeoMap(previousSummary.chinaProvinces || [])",
            dashboard,
        )
        self.assertIn("type: 'line'", dashboard)
        china_map = json.loads(
            (root / "assets" / "china.geojson").read_text(encoding="utf-8")
        )
        province_names = {
            feature.get("properties", {}).get("name")
            for feature in china_map.get("features", [])
        }
        self.assertTrue(
            {"北京市", "广东省", "台湾省", "香港特别行政区", "澳门特别行政区"}
            <= province_names
        )
        login = (root / "login.html").read_text(encoding="utf-8")
        self.assertIn("/api/cybercode-usage/login", login)
        self.assertNotIn("https://cdn.", login)


if __name__ == "__main__":
    unittest.main()
