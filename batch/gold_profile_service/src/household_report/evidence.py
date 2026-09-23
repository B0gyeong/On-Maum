from pyspark.sql import functions as F


def build_evidence(usage_summary, assessment_detail):
    usage = (
        usage_summary.withColumn("evidence_type", F.lit("USAGE_FREQUENCY"))
        .withColumn(
            "evidence_id",
            F.sha2(
                F.concat_ws(
                    "|", "household_id", "appliance_type", F.lit("USAGE_FREQUENCY")
                ),
                256,
            ),
        )
        .withColumn(
            "statement",
            F.when(
                F.col("eligible_days") > 0,
                F.concat(
                    F.col("eligible_days").cast("string"),
                    F.lit("개 유효 표본일 중 "),
                    F.col("active_days").cast("string"),
                    F.lit("일 사용했습니다."),
                ),
            ).otherwise(F.lit("사용 비율을 계산할 유효 표본이 없습니다.")),
        )
        .withColumn(
            "values_json",
            F.to_json(
                F.struct(
                    "eligible_days",
                    "active_days",
                    "use_probability",
                    "unknown_days",
                    "missing_days",
                )
            ),
        )
        .select(
            "household_id",
            "evidence_id",
            "evidence_type",
            "appliance_type",
            "statement",
            "values_json",
            "quality_status",
        )
    )
    assessment = (
        assessment_detail.withColumn("evidence_type", F.lit("RECORDED_ASSESSMENT"))
        .withColumn(
            "evidence_id",
            F.concat(F.lit("assessment:"), F.col("assessment_id").cast("string")),
        )
        .withColumn("appliance_type", F.lit(None).cast("string"))
        .withColumn("statement", F.lit("당시 모니터링에 저장된 평가와 비교 근거입니다."))
        .withColumn(
            "values_json",
            F.to_json(
                F.struct(
                    "assessment_id",
                    "assessed_at",
                    "assessment_status",
                    "risk_score",
                    "risk_level",
                    "profile_version",
                    "policy_version",
                    "score_version",
                    "indicators",
                )
            ),
        )
        .withColumn(
            "quality_status",
            F.when(F.col("indicators").isNull(), "MISSING_INDICATOR_EVIDENCE").otherwise(
                "RECORDED"
            ),
        )
        .select(
            "household_id",
            "evidence_id",
            "evidence_type",
            "appliance_type",
            "statement",
            "values_json",
            "quality_status",
        )
    )
    return usage.unionByName(assessment)
