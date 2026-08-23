| 작업 | 허용 | 서버 검사 |
|---|---|---|
| 주문·원장 조회 | 본인, ADMIN | `order.userId === session.userId` |
| 크리에이터 워크스페이스 | INFLUENCER, ADMIN | 역할 + 프로필 소유권 |
| 기회 상세/응답/제출 | 배정 회원 | `opportunity_assignments(opportunityId,userId)` + SELLER 기회는 `sellerStatus=APPROVED` + 상태 전이 허용표 |
| 셀러 센터 | SELLER & APPROVED | 역할 + 승인 상태 |
| 등급 제한/크리에이터/셀러 전용 상품 | visibility 규칙 | `canSeeProduct` (장바구니 추가 시 재검사) |
| 회원 역할·등급·포인트 조정, 환불, 정책, 초대, 승인 | ADMIN/SUPER_ADMIN | 사유 필수 + 감사 로그 |
| SUPER_ADMIN 부여, 기능 플래그 | SUPER_ADMIN | 감사 로그 |
| 정기 작업 엔드포인트 | 시스템 토큰 | `X-Job-Token` 또는 ADMIN 수동 |
