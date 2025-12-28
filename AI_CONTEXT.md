# 🤖 AI Handover & Project Context

이 문서는 다음에 이 프로젝트를 담당할 AI 어시스턴트가 프로젝트의 맥락을 빠르게 파악할 수 있도록 작성되었습니다.

## 📝 프로젝트 개요 (Project Overview)
- **이름:** SignsCheck (전자서명 수집 및 관리 시스템)
- **목적:** PDF 문서 내 참석자 이름을 자동으로 분석하여, 카카오톡/문자로 서명 요청을 보내고 법적 효력이 있는 전자서명 증명서를 생성합니다.

## 🚀 서비스 및 Git 정보
- **배포 주소:** [https://signscheck.vercel.app/](https://signscheck.vercel.app/)
- **GitHub 저장소:** [https://github.com/gapbbong/signscheck](https://github.com/gapbbong/signscheck)
- **배포 방식:** `master` 브랜치에 Push 시 Vercel에서 자동 빌드 및 배포됩니다.

## 🛠 핵심 기술 스택 및 구조
- **Frontend/Backend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Database/Storage:** Firebase Firestore, Firebase Storage
- **PDF Core:** `pdf-lib` (서명 삽입 및 증명서 생성), `pdfjs-dist` (PDF 텍스트 분석 및 좌표 추출)
- **결제:** Portone (포트원) 연동

## 🔍 주요 비즈니스 로직
1.  **PDF 분석 (`pdf-parser.ts`):** 업로드된 PDF에서 텍스트를 추출하고 이름과 좌표를 매칭합니다.
2.  **서명 위치 지정 (`PDFPreview.tsx`):** 분석된 좌표를 기반으로 캔버스 위에 서명란을 자동으로 배치하며, 사용자가 드래그 또는 방향키로 미세 조정이 가능합니다.
3.  **감사 로그 수집 (`page.tsx` 서명 페이지):** 서명 시점의 IP, UserAgent, Geolocation, Network, Screen 정보를 수집하여 Firestore에 저장합니다.
4.  **증명서 생성 (`PDFPreview.tsx`):** SHA-256 문서 해시와 상세 감사 데이터를 포함한 별도의 PDF 증명서를 생성합니다.

## 📂 데이터 스키마 (Firestore)
- **`requests` 컬렉션:** 서명 요청 건별 정보
  - `meetingId`: 회의 세션 ID
  - `status`: `pending` | `sent` | `signed`
  - `signatureUrl`: 서명 PNG 이미지 주소
  - `auditData`: 상세 감사 정보 객체
- **`meetings` 컬렉션:** 회의 세션 정보 (`pdfUrl`, `documentHash`, `attendees` JSON 등)

## 💡 다음 AI를 위한 팁
- PDF 좌표계는 좌하단이 (0,0)이지만, 브라우저 캔버스는 좌상단이 (0,0)입니다. 이 변환 로직이 `PDFPreview`의 핵심입니다.
- 새로운 필드를 추가할 때는 `src/app/page.tsx`의 `statusMap`과 `attendees` 상태의 타입 정의를 먼저 업데이트해야 합니다.
