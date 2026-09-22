package com.nilm.monitoring.config;

import java.sql.Date;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/**
 * Creates ten self-service users and households through the real APIs, then
 * links their Keycloak subs to monitoring subjects.
 */
@Slf4j
@Component
@DependsOnDatabaseInitialization
@ConditionalOnProperty(name = "app.test-data.enabled", havingValue = "true")
public class SubjectInitializer implements SmartInitializingSingleton {

    private static final String LEGACY_AUTH_SUB = "test-subject-3";
    private static final String LEGACY_NAME = "테스트 대상자";
    private static final String LEGACY_MEMO = "로컬 자동 생성 테스트 데이터";
    private static final String SEED_MEMO = "API로 자동 생성된 로컬 테스트 대상자";

    private final JdbcTemplate jdbc;
    private final TestDataApiClient api;
    private final ManagerInitializer managers;
    private final String password;

    public SubjectInitializer(
            JdbcTemplate jdbc,
            TestDataApiClient api,
            ManagerInitializer managers,
            @Value("${app.test-data.password:}") String password
    ) {
        this.jdbc = jdbc;
        this.api = api;
        this.managers = managers;
        this.password = password;
    }

    @Override
    public void afterSingletonsInstantiated() {
        if (!StringUtils.hasText(password)) {
            throw new IllegalStateException(
                    "TEST_DATA_ENABLED=true일 때 TEST_ACCOUNT_PASSWORD가 필요합니다."
            );
        }

        // Also guarantees ordering if Spring invokes the singleton callbacks
        // in a different bean order.
        managers.initialize();
        for (int index = 1; index <= ManagerInitializer.ACCOUNT_COUNT; index++) {
            createOrLinkSubject(index);
        }
        log.info("테스트 대상자 {}명의 계정·가구·subjects 연결 완료",
                ManagerInitializer.ACCOUNT_COUNT);
    }

    private void createOrLinkSubject(int index) {
        String name = String.format("대상자 %02d", index);
        String email = String.format("subject%02d@nilm.local", index);
        String phone = String.format("0101%07d", index);
        String houseId = String.format("H%03d", index);
        String alias = String.format("테스트 가구 %02d", index);
        String address = String.format("서울특별시 테스트로 %d", index);
        LocalDate birthDate = LocalDate.of(1949 + index, 1, 1);

        TestDataApiClient.SeedAccount account = api.ensureUser(
                email, password, name, phone, null
        );
        api.ensureHousehold(account, houseId, alias, 30);
        linkSubject(
                houseId,
                account.userId().toString(),
                birthDate,
                name,
                phone,
                address,
                managers.managerIdFor(index)
        );
    }

    private void linkSubject(
            String houseId,
            String authSub,
            LocalDate birthDate,
            String name,
            String phone,
            String address,
            long managerId
    ) {
        try {
            List<Map<String, Object>> matches = findMatches(houseId, authSub);
            if (matches.isEmpty()) {
                jdbc.update("""
                        INSERT INTO subjects (
                            household_id, auth_sub, birth_date, name, phone, address,
                            monitoring_enabled, manager_memo, manager_id
                        ) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?, ?)
                        """, houseId, authSub, Date.valueOf(birthDate), name, phone,
                        address, SEED_MEMO, managerId);
                return;
            }
            if (matches.size() != 1) {
                throw conflict(houseId, authSub);
            }

            Map<String, Object> existing = matches.get(0);
            String existingHouseId = (String) existing.get("household_id");
            String existingAuthSub = (String) existing.get("auth_sub");
            if (!houseId.equals(existingHouseId)) {
                throw conflict(houseId, authSub);
            }

            if (existingAuthSub != null && !authSub.equals(existingAuthSub)) {
                if (isLegacySeed(existing, houseId)) {
                    adoptLegacySeed(
                            existing.get("id"), authSub, birthDate, name,
                            phone, address, managerId
                    );
                    log.info("기존 LocalSubjectInitializer row를 API 계정으로 승계: householdId={}",
                            houseId);
                    return;
                }
                throw conflict(houseId, authSub);
            }

            jdbc.update("""
                    UPDATE subjects
                    SET auth_sub = COALESCE(auth_sub, ?),
                        manager_id = COALESCE(manager_id, ?)
                    WHERE id = ?
                    """, authSub, managerId, existing.get("id"));
        } catch (DuplicateKeyException e) {
            // A concurrent local instance may have inserted the same mapping.
            // Accept it only when both identifiers now point to one row.
            List<Map<String, Object>> matches = findMatches(houseId, authSub);
            if (matches.size() != 1
                    || !houseId.equals(matches.get(0).get("household_id"))
                    || !authSub.equals(matches.get(0).get("auth_sub"))) {
                throw conflict(houseId, authSub);
            }
        }
    }

    private List<Map<String, Object>> findMatches(String houseId, String authSub) {
        return jdbc.queryForList("""
                SELECT id, household_id, auth_sub, name, manager_memo
                FROM subjects
                WHERE household_id = ? OR auth_sub = ?
                """, houseId, authSub);
    }

    private boolean isLegacySeed(Map<String, Object> existing, String houseId) {
        return "H001".equals(houseId)
                && LEGACY_AUTH_SUB.equals(existing.get("auth_sub"))
                && LEGACY_NAME.equals(existing.get("name"))
                && LEGACY_MEMO.equals(existing.get("manager_memo"));
    }

    private void adoptLegacySeed(
            Object id,
            String authSub,
            LocalDate birthDate,
            String name,
            String phone,
            String address,
            long managerId
    ) {
        jdbc.update("""
                UPDATE subjects
                SET auth_sub = ?, birth_date = ?, name = ?, phone = ?, address = ?,
                    manager_memo = ?, manager_id = ?
                WHERE id = ?
                """, authSub, Date.valueOf(birthDate), name, phone, address,
                SEED_MEMO, managerId, id);
    }

    private IllegalStateException conflict(String houseId, String authSub) {
        return new IllegalStateException(
                "기존 subjects 연결과 테스트 계정이 충돌합니다: householdId="
                        + houseId + ", authSub=" + authSub
        );
    }
}
