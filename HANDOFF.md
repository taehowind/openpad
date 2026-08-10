# 인수인계 — Vercel + Supabase 배포

이 폴더는 **openPad**(강의용 협업 보드)의 소스입니다. 코드는 이미 두 배포 대상을 모두
지원하도록 되어 있고, 남은 일은 **실제 Supabase 프로젝트와 Vercel에 올려 검증**하는 것입니다.

원본 프로젝트(`D:\Workspace\ewp`)는 VPS에서 SQLite로 계속 서비스 중입니다. 이 폴더는 거기서
`git archive` 로 추출한 것이라 서버 설정·로컬 데이터·빌드 산출물은 들어 있지 않습니다.

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

## 아직 안 된 것

- **실제 Supabase 프로젝트로 검증하지 않았습니다.** 테스트는 순정 Postgres 17로만 했습니다.
  Supabase 고유 요소(트랜잭션 풀러, Storage API, RLS 기본값)는 미검증입니다.
- **Vercel에 실제 배포한 적이 없습니다.** 빌드 통과와 코드 경로만 확인된 상태입니다.
- 브라우저에서 대용량(4.5MB 초과) 직접 업로드를 **끝까지 돌려본 적이 없습니다.**

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
1. 이 폴더를 GitHub 새 저장소로 push
2. Vercel에서 임포트
3. 환경 변수 입력 (`.env.example` 참고). `SQLITE_PATH`, `UPLOAD_DIR` 은 **넣지 마세요**
4. 배포 후 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 로그인

### 4. 배포 후 반드시 확인할 것
- [ ] `/api/health` 가 `postgres` 로 응답
- [ ] 로그인 → 보드 생성 → 카드 작성
- [ ] **5MB 넘는 파일 첨부** (4.5MB 우회가 실제로 도는지 — 가장 중요)
- [ ] 갤러리 HTML 업로드 → 미리보기(`/api/embed/...`) → 짧은 링크(`/g/...`)
- [ ] 공유 링크로 수강생 입장 → 카드·댓글·채팅
- [ ] 보드 설정 변경, 버전 저장 → 복원
- [ ] 콜드스타트 후 첫 요청 지연 확인

---

## 미리 알아둘 함정 (이미 겪은 것들)

| 함정 | 내용 |
|---|---|
| **Transaction pooler 필수** | Direct connection 을 쓰면 커넥션 고갈. 풀러는 포트 `6543` |
| **`PGPOOL_MAX` 는 작게** | 인스턴스마다 풀이 생기므로 기본 4 유지 |
| **`prepared statement` 이슈** | 트랜잭션 풀러는 prepared statement 를 지원하지 않을 수 있음. `pg` 는 기본적으로 사용하지 않지만, 오류가 나면 확인할 것 |
| **`position` 은 INTEGER** | Postgres 는 21억이 상한. `Date.now()` 를 넣으면 터짐 (이미 수정됨) |
| **`COUNT(*)` 는 문자열** | `pg` 가 int8 을 문자열로 반환. `driver.ts` 에서 파서 등록해 둠 |
| **SQLite 전용 문법 금지** | `INSERT/UPDATE OR IGNORE` → `ON CONFLICT DO NOTHING` |
| **`output: "standalone"`** | Vercel 에서는 자동으로 꺼짐(`next.config.ts`). 건드리지 말 것 |
| **Vercel Hobby 는 비상업용** | 사내 교육 등 상업적 사용은 Pro 필요 |

## 작업 규칙

- SQL 은 `?` 자리표시자로 쓰고, **양쪽 엔진이 이해하는 문법**만 사용
- DB 헬퍼는 **반드시 await** — 빠뜨리면 트랜잭션 커밋 뒤에 실행되어 조용히 유실됩니다
  (실제로 `createRevision` 에서 이 버그가 있었고, 모든 버전 스냅샷이 `{}` 로 저장됐습니다)
- 파일 접근은 반드시 `src/lib/storage.ts` 경유
- 이 저장소에는 테스트 러너가 없습니다. `npm run build`, `npm run lint` 와 실제 앱 확인으로 검증
- `AGENTS.md` 경고대로 Next.js 16 은 학습 데이터와 다릅니다. 프레임워크 코드 작성 전
  `node_modules/next/dist/docs/` 를 확인하세요
