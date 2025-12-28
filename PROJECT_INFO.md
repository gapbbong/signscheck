# 프로젝트 정보 (Project Info)

## 🌐 서비스 정보
- **운영 사이트 주소 (Production):** [https://signscheck.vercel.app/](https://signscheck.vercel.app/)
- **미리보기 (Vercel Dashboard):** [https://vercel.com/gapbbong/signscheck](https://vercel.com/gapbbong/signscheck)

## 🐙 Git 정보
- **GitHub 저장소:** [https://github.com/gapbbong/signscheck](https://github.com/gapbbong/signscheck)
- **배포 방식:** `master` 브랜치에 `push` 시 Vercel 자동 배포 트리거

## 🛠 기술 스택
- **프레임워크:** Next.js (App Router)
- **데이터베이스:** Google Firebase Firestore
- **파일 저장소:** Google Firebase Storage
- **인증:** Firebase Authentication
- **PDF 처리:** pdf-lib, pdfjs-dist
- **결제 연동:** Portone (포트원)

## 📁 주요 디렉토리 구조
- `/src/app`: 페이지 및 API 라우트
- `/src/components`: 공통 UI 컴포넌트
- `/src/lib`: 유틸리티 서비스 (Firebase, PDF 파서 등)
- `/src/gas`: Google Apps Script (내부 연동용)
