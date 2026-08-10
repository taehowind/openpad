# openPad (AI STUDY)

강의용 Trello형 공유 보드입니다. 강사가 보드를 만들고, 수강생은 링크로 들어와 카드·댓글·질문을
남깁니다. 별도 회원가입 없이 닉네임과 이모티콘만으로 참여합니다.

> A Padlet-style collaboration board for classrooms. Self-host it with Docker, or deploy it to
> Vercel + Supabase. Same codebase either way — see [Deploying](#deploying).

## 주요 기능

- 강사 계정(가입 → 관리자 승인)과 다중 보드 관리
- 추측하기 어려운 공유 링크 + 짧은 참여 코드, QR 공유
- 이모티콘·닉네임 프로필, 기기 기반 자동 재입장
- 접속자 표시, 보드별 Q&A 채팅(강사가 가리기/삭제 가능)
- 보드별 접근 권한: 링크 공개 / 회원 전용, 읽기 전용 / 읽기·쓰기, 입장 비밀번호
- 실시간 마크다운 에디터, 파일·이미지 첨부, 드래그로 카드·목록 재배치
- 바이브코딩 갤러리: 학생이 만든 HTML을 샌드박스에서 미리보기, 하트·댓글·짧은 링크
- 보드 배경 18종(단색 10 + 그라디언트 8), 라이트/다크 모드
- 모든 활동 감사 기록, 자동 버전 스냅샷과 최종본 복원
- 목록·작품을 다른 보드로 이동·복사 (관리 권한 필요)

## Deploying

두 가지 방식을 지원하며, **소스는 완전히 동일**합니다. 환경 변수만 다릅니다.

### A. 자체 호스팅 (Docker) — 기본값

SQLite 파일 하나와 업로드 폴더를 볼륨에 두고 단일 컨테이너로 돌립니다. 실시간 갱신(SSE)이
그대로 동작합니다.

```bash
cp .env.example .env    # SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD 를 채우세요
docker compose up -d --build
```

기본값으로 `127.0.0.1:7400` 에 열립니다. 앞단에 리버스 프록시(Caddy/nginx)를 두고 HTTPS를
붙이세요. 데이터는 `openpad_data` 볼륨의 `/data` 에 저장됩니다.

### B. Vercel + Supabase

1. **Supabase** 프로젝트를 만들고
   - Storage 에서 **비공개(private)** 버킷을 하나 만듭니다 (기본 이름 `uploads`).
   - 스키마는 첫 요청 때 앱이 알아서 만듭니다. 미리 만들고 싶다면 SQL Editor 에
     `supabase/migrations/0001_initial_schema.sql` 를 실행하세요.
2. **Vercel** 에 이 저장소를 임포트하고 환경 변수를 넣습니다.
   `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`
   (자세한 형식은 `.env.example` 참고)
3. 배포 후 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 로그인합니다.

`DATABASE_URL` 은 Supabase 의 **Transaction pooler** 주소를 쓰세요. 서버리스는 인스턴스가
수시로 뜨고 지므로 직접 연결은 커넥션이 금방 고갈됩니다.

서버리스에서 달라지는 점 두 가지:

- **실시간 갱신이 폴링으로 바뀝니다.** 푸시(SSE)는 한 프로세스가 모든 구독자를 담당할 때만
  동작하므로, 이 환경에서는 15초 주기 폴링이 대신 처리합니다. 사용감 차이는 크지 않습니다.
- **업로드가 브라우저 → 스토리지로 직접 갑니다.** Vercel 함수는 요청 본문이 4.5MB로 제한되어
  10MB 첨부가 통과할 수 없기 때문입니다. 앱이 자동으로 처리하므로 설정할 것은 없습니다.

> **Vercel Hobby(무료) 플랜은 비상업적 용도로 제한됩니다.** 사내 교육 등 상업적 목적이라면
> Pro 플랜이 필요합니다. Supabase 도 무료 한도를 넘으면 과금됩니다.

## 개발

```bash
npm install
cp .env.example .env.local   # SQLITE_PATH=./data/dev.sqlite 처럼 로컬 경로로 바꾸세요
npm run dev
```

Postgres 경로를 확인하려면 `DATABASE_URL` 만 추가로 지정하면 됩니다.

```bash
npm run lint     # eslint
npm run build    # 프로덕션 빌드
```

이 저장소에는 테스트 러너가 없습니다. 변경 후에는 `npm run build` 와 `npm run lint`,
그리고 실제 앱을 띄워 확인해 주세요.

## 아키텍처 메모

- **데이터 계층은 드라이버 중립**입니다. `src/lib/db.ts` 의 `get/all/run/transaction` 만
  사용하고, SQL 은 `?` 자리표시자와 양쪽 엔진이 모두 이해하는 문법으로 씁니다
  (Postgres 어댑터가 `$n` 으로 바꿔 줍니다). 엔진별로 갈리는 부분은
  `src/lib/driver.ts` 와 `src/lib/schema.ts` 안에만 있습니다.
- **파일 접근은 `src/lib/storage.ts` 를 통해서만** 합니다. 로컬 볼륨과 오브젝트 스토리지
  구현이 같은 인터페이스 뒤에 있습니다.
- 업로드된 HTML 은 `sandbox` CSP 로 격리된 오리진에서 제공되어, 우리 쿠키나 DOM 에 접근할 수
  없습니다.

## 라이선스

[Apache License 2.0](LICENSE) — 상업적 이용, 수정, 재배포가 가능합니다.
