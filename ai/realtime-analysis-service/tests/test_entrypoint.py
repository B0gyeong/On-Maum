import pytest

from realtime_analysis.config import Settings


def test_default_topic_contracts() -> None:
    settings = Settings(_env_file=None)

    assert settings.kafka_input_topic == "power.raw.v1"
    assert settings.kafka_analysis_event_topic == "analysis.event.v1"
    assert settings.kafka_analysis_activity_topic == "analysis.activity.v1"
    assert settings.kafka_analysis_data_quality_topic == "analysis.data-quality.v1"
    assert settings.kafka_analysis_snapshot_topic == "analysis.snapshot.v1"
    assert settings.kafka_outing_event_topic == "monitoring.household-presence.v1"
    assert settings.kafka_outing_group_id == "realtime-analysis-service-outing-v1"
    assert settings.consumer_config() == {
        "bootstrap.servers": "localhost:9092",
        "group.id": "realtime-analysis-service-v1",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": True,
        "enable.auto.offset.store": False,
        "partition.assignment.strategy": "cooperative-sticky",
    }
    assert settings.outing_consumer_config() == {
        "bootstrap.servers": "localhost:9092",
        "group.id": "realtime-analysis-service-outing-v1",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": True,
        "enable.auto.offset.store": False,
        "partition.assignment.strategy": "cooperative-sticky",
    }
    assert settings.http_host == "0.0.0.0"
    assert settings.http_port == 8000
    assert settings.activity_index_publish_hour == 0
    assert settings.activity_index_publish_minute == 10
    assert settings.routine_baseline_refresh_seconds == 60
    assert settings.analysis_data_gap_threshold_seconds == 120
    assert settings.analysis_data_quality_poll_seconds == 5
    assert settings.analysis_data_recovery_confirmation_samples == 3
    assert settings.analysis_e2e_clock_skew_tolerance_seconds == 0.1


def test_fake_appliance_setting_is_parsed() -> None:
    settings = Settings(
        _env_file=None,
        fake_on_appliances=" microwave, hair_dryer ",
    )

    assert settings.fake_on_appliance_types == ("MICROWAVE", "HAIR_DRYER")


def test_static_membership_ids_are_loaded_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "KAFKA_PARTITION_ASSIGNMENT_STRATEGY",
        "cooperative-sticky",
    )
    monkeypatch.setenv("KAFKA_GROUP_INSTANCE_ID", " analysis-node-01-power ")
    monkeypatch.setenv(
        "KAFKA_OUTING_GROUP_INSTANCE_ID",
        "analysis-node-01-outing",
    )

    settings = Settings(_env_file=None)

    assert settings.consumer_config()["group.instance.id"] == (
        "analysis-node-01-power"
    )
    assert settings.outing_consumer_config()["group.instance.id"] == (
        "analysis-node-01-outing"
    )


def test_blank_static_membership_ids_are_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KAFKA_GROUP_INSTANCE_ID", "  ")
    monkeypatch.setenv("KAFKA_OUTING_GROUP_INSTANCE_ID", "")

    settings = Settings(_env_file=None)

    assert "group.instance.id" not in settings.consumer_config()
    assert "group.instance.id" not in settings.outing_consumer_config()


def test_e2e_clock_skew_tolerance_is_loaded_from_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "ANALYSIS_E2E_CLOCK_SKEW_TOLERANCE_SECONDS",
        "0.25",
    )

    settings = Settings(_env_file=None)

    assert settings.analysis_e2e_clock_skew_tolerance_seconds == 0.25
