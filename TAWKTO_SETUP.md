# Tawk.to 챗봇 설정 가이드

## 🚀 설치 완료!

Tawk.to 챗봇 위젯이 설치되었습니다. 이제 설정만 하면 됩니다!

---

## 📋 설정 단계

### 1. Tawk.to 가입
1. https://www.tawk.to 접속
2. "Sign Up Free" 클릭
3. 이메일로 가입

### 2. Property 생성
1. 대시보드에서 "Add Property" 클릭
2. **Property Name**: `SignsCheck`
3. **Website URL**: `https://signscheck.vercel.app`

### 3. Widget ID 복사
1. 대시보드 → Administration → Property Settings
2. **Direct Chat Link** 섹션에서 코드 확인
3. URL에서 두 개의 ID 복사:
   ```
   https://embed.tawk.to/[PROPERTY_ID]/[WIDGET_ID]
   ```

### 4. 코드에 적용
`src/components/TawkToWidget.tsx` 파일 수정:
```typescript
script.src = "https://embed.tawk.to/YOUR_PROPERTY_ID/YOUR_WIDGET_ID";
// ↓ 복사한 ID로 변경
script.src = "https://embed.tawk.to/67abc123def/1hijk456lmn";
```

---

## 🤖 자동 응답 설정

### 1. 환영 메시지
**Dashboard → Chat Widget → Triggers → Add Trigger**

**조건**: Visitor opens chat
**메시지**:
```
안녕하세요! SignsCheck입니다 👋

무엇을 도와드릴까요?

1️⃣ 사용법 안내
2️⃣ 가격 문의  
3️⃣ 기술 지원
```

### 2. 자주 묻는 질문 자동 응답

**Shortcuts 설정** (Dashboard → Shortcuts)

#### Q1: 사용법
**Shortcut**: `#사용법`
**답변**:
```
📝 SignsCheck 사용법

1. PDF 파일 업로드
2. 참석자 이름 확인/추가
3. "🚀 요청 보내기" 클릭
4. 생성된 링크를 카톡/라인으로 전송
5. 실시간으로 서명 현황 확인!

자세한 가이드: https://signscheck.vercel.app
```

#### Q2: 가격
**Shortcut**: `#가격`
**답변**:
```
💰 SignsCheck 가격

✅ 현재: 완전 무료!
✅ 무제한 회의
✅ 무제한 참석자
✅ 모든 기능 사용 가능

향후 Pro 플랜 출시 예정 (월 4,900원)
```

#### Q3: 모바일
**Shortcut**: `#모바일`
**답변**:
```
📱 모바일 지원

✅ 서명자: 모바일 최적화 완료
✅ 관리자: 모바일에서도 사용 가능

별도 앱 설치 필요 없이
웹 브라우저에서 바로 사용하세요!
```

#### Q4: 문제 해결
**Shortcut**: `#문제`
**답변**:
```
🔧 문제 해결

서명이 안 되시나요?
1. 브라우저 새로고침 (F5)
2. 다른 브라우저로 시도
3. 캐시 삭제 후 재시도

여전히 안 되면 상세 내용을 알려주세요!
```

### 3. 부재중 메시지
**Dashboard → Chat Widget → Offline Messages**

```
지금은 자리를 비웠습니다 😴

24시간 내에 답변드리겠습니다.
급하신 경우 이메일로 문의해주세요:
support@signscheck.com
```

---

## 📱 모바일 앱 설치

실시간 응답을 위해 모바일 앱 설치:
- iOS: App Store에서 "Tawk.to"
- Android: Play Store에서 "Tawk.to"

앱에서 로그인하면 실시간 알림을 받을 수 있습니다!

---

## 🎨 위젯 커스터마이징

**Dashboard → Chat Widget → Appearance**

### 추천 설정:
- **Widget Color**: `#3b82f6` (파란색)
- **Widget Position**: 우측 하단
- **Widget Size**: Medium
- **Bubble Text**: "💬 무엇을 도와드릴까요?"

---

## ✅ 테스트

1. https://signscheck.vercel.app 접속
2. 우측 하단 챗봇 아이콘 확인
3. 클릭해서 메시지 전송 테스트
4. 모바일 앱에서 알림 확인

---

## 📊 분석

**Dashboard → Monitoring**에서 확인 가능:
- 총 대화 수
- 평균 응답 시간
- 자주 묻는 질문
- 방문자 통계

---

**설정 완료 후 배포하시면 바로 사용 가능합니다!** 🎉
