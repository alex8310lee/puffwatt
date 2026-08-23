# PUFFWATT — Private Access Club (MVP)

초대 기반 프라이빗 멤버십 풀스택 MVP. **외부 의존성 0** — Node 22의 내장 SQLite(`node:sqlite`)와 `node:http`만 사용합니다.

## 실행 — 가장 빠른 방법
- **설치 없이 HTML 하나로**: `dist/PUFFWATT.html`(또는 `npm run build:html`)을 더블클릭. 브라우저 안에서 SQLite(WASM)가 돌고 데이터는 localStorage에 저장됩니다. 오프라인 동작, 모바일 브라우저 OK. 초기화: 콘솔에서 `__resetPuffwatt()`. 비밀번호 해시는 데모용 단순 해시이며 운영용이 아닙니다.
- **macOS**: `run.command` 더블클릭 (처음엔 우클릭 → 열기)  ·  **Windows**: `run.bat` 더블클릭  ·  **Linux**: `./run.sh`
- 브라우저가 자동으로 http://localhost:3000 을 엽니다. 첫 실행 시 DB와 데모 데이터가 자동 생성됩니다.
- **Docker**: `docker build -t puffwatt . && docker run -p 3000:3000 -v puffwatt-data:/data puffwatt`
- **클라우드(공개 URL)**: 저장소에 올린 뒤 Render(`render.yaml`) 또는 Railway(`railway.json`)에서 New → 저장소 선택 → 배포. 빌드 단계 없이 바로 뜹니다.

## 수동 실행
```bash
node -v            # >= 22.5
npm run seed       # 멱등 시드 (여러 번 실행해도 중복 없음)
npm run dev        # http://localhost:3000  (PUFFWATT_ENV=development → 데모 로그인 활성)
npm test           # 정책·원장·추천·퀘스트 순수 엔진 단위 테스트
```
프로덕션: `PUFFWATT_ENV=production PUFFWATT_JOB_TOKEN=<secret> PORT=3000 node server/index.js` — 데모 로그인/데모 비밀번호는 자동 비활성, 쿠키 `Secure` 적용.

## 테스트 계정 (비밀번호 `Puffwatt!2026`, 데모 전용)
| 계정 | 이메일 | 역할·등급 | 100,000원 등급가 상품 | 최대 포인트 | 현금 적립 |
|---|---|---|---|---|---|
| Standard | standard@demo.puffwatt.local | GENERAL · STANDARD | 100,000 | 30% | 5% |
| Silver | silver@… | GENERAL · SILVER | 98,000 | 40% | 6% |
| Gold Creator | gold@… | +INFLUENCER · GOLD · VERIFIED | 90,000 | 70% | 10% |
| Black Creator | black@… | +INFLUENCER · BLACK · MEGA | 85,000 | 90% | 12% |
| Icon VIP | icon@… | +INFLUENCER · ICON · CELEBRITY | 80,000 | 100% | 15% |
| Approved Seller | seller@… | +SELLER · STANDARD (역할 타깃) | 92,000 | 40% | 6% |
| Hybrid | hybrid@… | +INFLUENCER+SELLER · BLACK · PRO | 82,000 | 85% | 14% |
| Super Admin | admin@… | SUPER_ADMIN | 100,000 | 30% | 5% |

초대 코드: `PUFF-GOLD-26` (Gold Creator가 초대, SILVER 등급 가입) · `PUFF-OPEN-26` (STANDARD).
추천 계보: Standard → Silver → Gold Creator (Standard는 Silver의 L1, Gold의 L2).

## 구조
```
server/domain.js     순수 계산 엔진 (가격·네 한도 최솟값·쿠폰/바우처·분할·적립·추천·회수·차감·퀘스트 자격)
server/services.js   정책/커머스/원장/퀘스트/업적/크리에이터/기회/셀러/어드민/정기작업 — 모든 계산은 서버
server/db.js         스키마 (48 테이블·인덱스·멱등 키), 트랜잭션 헬퍼
server/seed.js       멱등 시드 (브랜드 5, 상품 14 + 서비스 4, 정책 v2.4/v2.5, 퀘스트 3, 기회 7, 정산, 쿠폰/바우처)
server/auth.js       scrypt 비밀번호, HttpOnly 세션, RBAC, 수동 오버라이드 우선 등급, 감사 기록
server/index.js      HTTP 라우터 (47 엔드포인트), 정적 서빙, 시스템 인증 예약 작업
public/              모바일 우선 회원 SPA(다크) + 데스크톱 어드민(라이트), 해시 라우터, 프레임워크 없음
tests/               node:test 단위 테스트 10건
docs/test-results/   375/768/1280 실제 렌더 캡처 25장 (수평 오버플로 0, 런타임 오류 0)
```

## 핵심 규칙 (구현됨)
- 금액·포인트 정수(KRW, P), 비율은 bp(10000=100%). 클라이언트는 렌더링만.
- 주문 시 `benefitSnapshotJson`(정책 버전·등급·역할·산식 결과) 불변 보존. 미래 정책이 과거 주문을 바꾸지 않음.
- 실제 포인트 한도 = MIN(회원 등급, 상품, 브랜드, 캠페인). 적립 기준 = 현금 순매출(포인트·배송비·환불 제외).
- 원장은 덮어쓰지 않고 USE/RESTORE/REVOKE/EXPIRE/ADJUST 행 추가. 차감은 만료 임박 순. 모든 원장 행에 `idempotencyKey UNIQUE`.
- PENDING → 구매확정 시 AVAILABLE. 전체취소·부분반품 시 본인 적립·L1/L2·XP 비례 회수 + 사용 포인트 비례 복원 + 재고 복구 + 환불 행, 한 트랜잭션.
- L2: 실적 추적(`ENABLE_L2_NETWORK_VOLUME`)과 소비 가능 보상(`ENABLE_L2_SPENDABLE_REWARD`, 기본 OFF) 분리.
- 퀘스트 완료는 `BEGIN IMMEDIATE` 트랜잭션에서 자격·기간·조건·정원·중복을 재검사. `UNIQUE(questId,userId)`.
- 서버 RBAC + 객체 소유권: 타인 주문, 미배정 기회, 미승인 셀러, 등급 제한 상품은 403.
- 수동 티어 오버라이드는 자동 등급보다 우선, 종료 시 `revert-overrides` 작업으로 복귀. 모든 관리자 변경은 `admin_audit_logs`(전/후 JSON·사유·IP 해시).
- 정기 작업(`monthly-credit`, `expire-points`, `release-pending`, `revert-overrides`, `activate-scheduled-policy`)은 요청 단위·멱등. `POST /api/jobs/:job` + `X-Job-Token`, 또는 어드민 수동 실행.

## PRODUCTION BLOCKER (데모 어댑터로만 존재)
실결제 PG·웹훅 / 본인인증·연령확인 / SNS 공식 API·토큰 암호화 / 셀러·크리에이터 자동 정산·세금계산서·원천징수 / 개인정보 보존·삭제·내보내기 / L1·L2 보상 법률 검토(`ENABLE_L2_SPENDABLE_REWARD=false` 유지) / 부정 가입·자기추천 탐지 / 관리자 2FA·재인증 / 이메일·SMS 발송 / 모니터링·백업. 이미지 업로드는 미구현(포트폴리오는 메타데이터만).
