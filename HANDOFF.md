# 인수인계 — Vercel + Supabase 배포

이 폴더는 **openPad**(강의용 협업 보드)의 소스입니다. 코드는 두 배포 대상을 모두 지원하고,
**실제 Supabase 프로젝트와 Vercel 배포까지 검증을 마쳤습니다** (2026-08-10). 그 과정에서
프로덕션 블로커 두 건을 찾아 고쳤습니다 — 아래 "실제 배포에서 드러난 것" 참고.

원본 프로젝트(`D:\Workspace\ewp`)는 VPS에서 SQLite로 계속 서비스 중입니다. 이 폴더는 거기서
`git archive` 로 추출한 것이라 서버 설정·로컬 데이터·빌드 산출물은 들어 있지 않습니다.

---

## 실제 배포에서 드러난 것 (2026-08-10)

순정 Postgres 17 직결 테스트로는 **절대 잡히지 않는** 버그 두 건이 있었습니다. 둘 다 수정됨.

### 1. 콜드스타트 스키마 잠금이 트랜잭션 풀러에서 무너짐

`applySchema` 가 `pg_advisory_lock` → migrate → `pg_advisory_unlock` 을 **세 개의 별도 문장**으로
실행했습니다. 세션 수명 잠금인데 풀러는 트랜잭션마다 다른 백엔드를 배정하므로, 4개 인스턴스
동시 콜드스타트 재현 결과:

```
instance 1: acquire@12266 | unlock@12262 released=false   *** 누수
instance 4: acquire@12266 | unlock@12262 released=false   *** 누수   ← 같은 백엔드, 둘 다 획득 성공
instance 2/3: acquire 에서 20초 타임아웃
이후 모든 콜드스타트: BLOCKED (백엔드를 kill 하기 전까지 영구)
```

상호 배제가 성립하지 않고, 해제도 안 되고, DB가 영구히 막힙니다. 지금은 **하나의 트랜잭션
안에서 `pg_advisory_xact_lock`** 을 씁니다. 트랜잭션은 한 백엔드에 고정되고 COMMIT이 항상 해제합니다.

같이 고친 것: `driver.columns()` 가 트랜잭션 컨텍스트를 무시하고 풀에 직접 질의했습니다.
migrate 가 트랜잭션 안으로 들어가면서, 커밋 전 DDL 이 보이지 않아 방금 만든 테이블을
"컬럼 없음"으로 보고 → `ALTER TABLE ADD COLUMN` 이 중복 추가를 시도하게 됩니다.

### 2. 앱 자신의 CSP 가 브라우저 → 버킷 업로드를 차단

`next.config.ts` 의 `connect-src 'self'` 때문에 서명 URL 로의 PUT 이 **브라우저에서 한 번도
나간 적이 없었습니다.**

```
Connecting to 'https://<project>.supabase.co/storage/v1/object/upload/sign/…'
violates the following Content Security Policy directive: "connect-src 'self'".
```

왜 아무도 몰랐나: `attachFile` 이 티켓 요청과 PUT 을 하나의 try/catch 로 감싸고, 던져진 것은
전부 "티켓 라우트 접속 실패"로 간주해 **파일 전체를 API 로 보내는 폴백**을 탔습니다. 로컬은
바디 상한이 없어 성공하고, Vercel 에서는 4.5MB 초과가 전부 413 이 됩니다. 실측:

```
3MB → /api/…/cards   http=201
6MB → /api/…/cards   http=413  FUNCTION_PAYLOAD_TOO_LARGE
```

이제 `connect-src` 가 설정된 버킷 오리진을 포함하고(설정됐을 때만 — 자체호스팅은 그대로 잠김),
폴백은 원래 의도한 두 경우로만 좁혔습니다: 티켓 라우트에 도달조차 못한 경우와 501.
**CSP 헤더는 빌드 타임에 구워집니다. `SUPABASE_URL` 을 바꾸면 재시작이 아니라 재배포가 필요합니다.**

## 배포 시 결정된 것

- **전용 DB 역할 `openpad_app`** 을 만들어 씁니다 (`postgres` 슈퍼유저 아님). 풀러 사용자명은
  `openpad_app.<project-ref>` 형식입니다. 이게 보안상 중요한 이유는 아래 RLS 항목 참고.
- 풀러 호스트는 `aws-0-ap-southeast-1.pooler.supabase.com:6543` (aws-1 은 이 테넌트를 거부).
  `db.<ref>.supabase.co` 는 IPv4 로 해석되지 않으므로 직결은 불가.
- **Supabase 어드바이저의 "RLS 비활성화(critical)" 경고는 이 구성에서는 오탐입니다.** 테이블
  소유자가 `openpad_app` 이라 Supabase 의 기본 권한 부여(`postgres` 소유)가 적용되지 않아
  `anon`/`authenticated` 는 14개 테이블 전부에 권한이 없습니다. PostgREST 로 확인 시 읽기·쓰기
  모두 `401 permission denied`. **반대로 `postgres` 슈퍼유저로 붙였다면 진짜 구멍이었습니다** —
  그 경우 publishable 키만으로 `instructors` 의 비밀번호 해시와 전 보드의 `share_token` 이 읽힙니다.
- Vercel 프로젝트는 검증 목적상 **개인 Hobby 계정**(`deankim/openpad`)에 올라가 있습니다.
  **Hobby 는 비상업용 전용이므로 실서비스는 Pro 팀 계정으로 옮겨야 합니다.**
- 배포 시 Vercel Authentication 이 기본으로 켜져 있어 껐습니다. 수강생은 Vercel 계정이 없으므로
  켜져 있으면 공유 링크가 동작하지 않습니다.

## 남은 권고 사항 (블로커 아님)

- `/api/files/[id]` 가 객체 전체를 함수 메모리로 읽어 되돌려줍니다(`readUpload` 가 `Buffer` 반환).
  8MB 다운로드에 5.6초가 걸렸고, 강사 상한인 100MB 는 그대로 함수 메모리에 올라갑니다.
  서명된 다운로드 URL 로 리다이렉트하는 편이 낫습니다.
- Git 연동이 없어 `vercel deploy` 로만 배포됩니다. 자동 배포가 필요하면 GitHub 저장소를 연결하세요.

---

## 이미 되어 있는 것 (다시 만들지 마세요)

- **데이터 계층이 드라이버 중립.** `src/lib/db.ts` 의 `get/all/run/transaction` 은 전부 async이고,
  `DATABASE_URL` 이 있으면 Postgres(`pg`), 없으면 `node:sqlite` 로 붙습니다(`src/lib/driver.ts`).
  SQL은 `?` 자리표시자로 한 번만 쓰고 어댑터가 `$n` 으로 바꿉니다.
- **스키마**는 `src/lib/schema.ts` 가 첫 요청 때 자동 생성합니다. 미리 만들고 싶으면
  `supabase/migrations/0001_initial_schema.sql` 을 Supabase SQL Editor에서 실행하세요(선택).
- **파일 저장**은 `src/lib/storage.ts` 뒤에 로컬 볼륨 / Supabase Storage 두 구현이 있습니다.
- **4.5MB 우회**: 오브젝트 스토리지가 설정되면 브라우저가 `/api/boards/[slug]/uploads` 로
  서명 URL을 받아 **버킷에 직접 업로드**하고, 함수에는 객체 이름만 전달합니다.
- **서버리스 대응**(`src/lib/runtime.ts`): SSE 비활성화(클라이언트가 15초 폴링으로 대체),
  로그인 레이트리밋을 DB 기반으로 전환.
- **검증 완료**: 동일 소스로 SQLite 41/41, Postgres 41/41 통과(임시 Postgres 17 컨테이너 대상).

## 검증 완료 상태 (2026-08-10)

전부 실제 Supabase 프로젝트 대상. `flow.mjs` 46항목 체크리스트 기준.

| 대상 | 결과 |
|---|---|
| 로컬 → Supabase Postgres | 46/46 |
| 로컬 → SQLite (자체호스팅 회귀) | 45/46 (유일한 실패는 `postgres` 를 단언한 항목) |
| Vercel 프로덕션 → Supabase | 46/46 |
| Storage HTTP 계약 (7MB) | 13/13 — 서명·PUT·HEAD·크기·바이트 일치·덮어쓰기 거부·비공개·삭제 |
| 직접 업로드 서버 측 | 10/10 — 강사·수강생 6MB, 11MB 413, 미업로드 이름 409, 외부인 403 |
| 브라우저 대용량 업로드 (프로덕션) | **8MB 완주** — PUT 8,388,608 bytes 1505ms, 카드 등록 시 파일 바이트 0, 다운로드 체크섬 일치 |
| 콜드스타트 동시성 | 동시 요청 20개 후 잔존 advisory lock 0, idle-in-transaction 0 |

지연: 콜드스타트 약 6~7초(풀러 접속 + 스키마 점검 포함), 웜 약 0.66초.

## 아직 안 된 것

- 실제 강의 규모(수십 명 동시 접속)의 부하 테스트.
- Pro 팀 계정으로의 이전 (현재 개인 Hobby 계정).

---

## 진행 순서

### 1. Supabase 준비
1. 프로젝트 생성
2. **Storage → 비공개(private) 버킷** 생성. 이름은 `uploads` (다르게 하면 `SUPABASE_STORAGE_BUCKET` 로 지정)
3. `Project Settings → Database → Connection string → **Transaction pooler**` 주소 복사
   (Direct connection 아님 — 서버리스는 커넥션이 금방 고갈됩니다)
4. `Project Settings → API` 에서 `URL` 과 **service_role** 키 복사
   (service_role 은 RLS를 우회하는 서버 전용 비밀입니다. 절대 브라우저에 노출 금지)

### 2. 로컬에서 Supabase 붙여 먼저 확인
```bash
npm install
cp .env.example .env.local
# .env.local 에 DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# SUPABASE_STORAGE_BUCKET, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD 를 채우기
npm run dev
```
`/api/health` 가 `{"database":"postgres"}` 를 반환해야 합니다.

### 3. Vercel 배포
GitHub 임포트 대신 CLI 로도 됩니다 (현재 배포가 이 방식입니다):
```bash
vercel link --yes --scope <team> --project openpad --token "$VERCEL_TOKEN"
printf '%s' "<value>" | vercel env add DATABASE_URL production --token "$VERCEL_TOKEN"   # 항목별 반복
vercel deploy --prod --yes --scope <team> --token "$VERCEL_TOKEN"
```
- 환경 변수 8개: `SESSION_SECRET` `ADMIN_EMAIL` `ADMIN_PASSWORD` `DATABASE_URL`
  `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `SUPABASE_STORAGE_BUCKET` `PGPOOL_MAX`.
  `SQLITE_PATH`, `UPLOAD_DIR` 은 **넣지 마세요**
- 토큰은 **배포할 팀 범위로** 발급해야 합니다. 개인 범위 토큰은 팀 프로젝트에 `forbidden` 입니다
- **Vercel Authentication 을 끄세요.** 기본으로 켜져 있고, 켜져 있으면 Vercel 계정이 없는
  수강생은 공유 링크로 들어올 수 없습니다
- `ADMIN_PASSWORD` 는 **관리자가 아직 없을 때만** 적용됩니다(`seedAdminInstructor`). 이미 있는
  계정의 비밀번호는 바뀌지 않으니, 바꾸려면 `instructors.password_hash` 를 직접 갱신하세요

### 4. 배포 후 반드시 확인할 것
`scratchpad/flow.mjs` 같은 하네스로 자동화할 수 있습니다. 항목:
- [x] `/api/health` 가 `postgres` 로 응답
- [x] 로그인 → 보드 생성 → 카드 작성
- [x] **5MB 넘는 파일 첨부** — 네트워크 로그에서 `supabase.co` 로의 PUT 이 실제로 나가고
      `/cards` 요청의 파일 바이트가 **0** 인지까지 확인할 것. 폴백을 타면 로컬에서는 조용히
      성공하므로, 카드가 생겼다는 사실만으로는 검증이 되지 않습니다
- [x] 갤러리 HTML 업로드 → 미리보기(`/api/embed/...`) → 짧은 링크(`/g/...`)
- [x] 공유 링크로 수강생 입장 → 카드·댓글·채팅
- [x] 보드 설정 변경, 버전 저장 → 복원
- [x] 콜드스타트 후 첫 요청 지연 확인
- [x] 동시 요청을 뿌린 뒤 `select count(*) from pg_locks where locktype='advisory'` 가 0 인지

---

## 미리 알아둘 함정 (이미 겪은 것들)

| 함정 | 내용 |
|---|---|
| **Transaction pooler 필수** | Direct connection 을 쓰면 커넥션 고갈. 풀러는 포트 `6543`. `db.<ref>.supabase.co` 는 IPv4 로 해석되지도 않음 |
| **세션 수명 상태를 쓰지 말 것** | 풀러는 문장마다 다른 백엔드를 줍니다. `pg_advisory_lock`, `SET`, `LISTEN` 은 다음 문장에서 남아 있지 않습니다. 반드시 하나의 트랜잭션 안에서 (`pg_advisory_xact_lock`) 쓰세요 — 실제로 이걸로 DB가 막혔습니다 |
| **`PGPOOL_MAX` 는 작게** | 인스턴스마다 풀이 생기므로 기본 4 유지 |
| **`prepared statement` 이슈** | 트랜잭션 풀러는 prepared statement 미지원. 다만 `pg` 는 unnamed statement 만 쓰므로 실제로는 문제 없음 (확인함) |
| **CSP 가 버킷 업로드를 막음** | `connect-src` 에 버킷 오리진이 없으면 브라우저→버킷 PUT 이 차단됩니다. 헤더는 빌드 타임에 구워지므로 `SUPABASE_URL` 변경 시 **재배포** 필요 |
| **업로드 폴백은 조용함** | 직접 업로드가 실패해도 예전 코드는 API 로 폴백해 로컬에서는 성공한 것처럼 보였습니다. 지금은 티켓 발급 이후의 실패를 그대로 노출합니다 |
| **`position` 은 INTEGER** | Postgres 는 21억이 상한. `Date.now()` 를 넣으면 터짐 (이미 수정됨) |
| **`COUNT(*)` 는 문자열** | `pg` 가 int8 을 문자열로 반환. `driver.ts` 에서 파서 등록해 둠 |
| **SQLite 전용 문법 금지** | `INSERT/UPDATE OR IGNORE` → `ON CONFLICT DO NOTHING` |
| **`output: "standalone"`** | Vercel 에서는 자동으로 꺼짐(`next.config.ts`). 건드리지 말 것 |
| **Vercel Hobby 는 비상업용** | 사내 교육 등 상업적 사용은 Pro 필요. **현재 배포는 개인 Hobby 계정이라 이전이 필요합니다** |
| **RLS 경고는 오탐 (조건부)** | 어드바이저가 critical 로 경고하지만, 테이블 소유자가 전용 역할이면 `anon` 에 권한이 없어 실제로는 막힙니다. **`postgres` 슈퍼유저로 붙이면 진짜 구멍이 됩니다** |

## 작업 규칙

- SQL 은 `?` 자리표시자로 쓰고, **양쪽 엔진이 이해하는 문법**만 사용
- DB 헬퍼는 **반드시 await** — 빠뜨리면 트랜잭션 커밋 뒤에 실행되어 조용히 유실됩니다
  (실제로 `createRevision` 에서 이 버그가 있었고, 모든 버전 스냅샷이 `{}` 로 저장됐습니다)
- 파일 접근은 반드시 `src/lib/storage.ts` 경유
- 이 저장소에는 테스트 러너가 없습니다. `npm run build`, `npm run lint` 와 실제 앱 확인으로 검증
- `AGENTS.md` 경고대로 Next.js 16 은 학습 데이터와 다릅니다. 프레임워크 코드 작성 전
  `node_modules/next/dist/docs/` 를 확인하세요
