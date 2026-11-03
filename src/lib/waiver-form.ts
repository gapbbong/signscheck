/**
 * 개인 서식형 (성적 이의신청 포기원)
 *
 * 회의록형/명렬표형과 달리 "학생 1명 = 문서 1장"이고 서명자는 이름이 아니라
 * 역할(학생/보호자)이다. 서명 위치는 PDF에서 추정하지 않고 서식이 직접 정의한다.
 */

export type WaiverRole = 'student' | 'guardian';

export const ROLE_LABEL: Record<WaiverRole, string> = {
    student: '학생',
    guardian: '보호자',
};

export interface WaiverParams {
    schoolName: string;
    round: string;
    expStart: string;
    expEnd: string;
    expDays: string;
    docDate: string;
    regulation: string;
}

export const DEFAULT_REGULATION =
    '제 14조 정기시험의 채점: 고사 응시와 성적 확인 및 재시험 발생을 고려하여 고사 기간 전·후 7일(주말 및 공휴일 제외)간은 학교장 허가 교외체험학습을 불허한다. 다만, 성적 이의신청 포기원(별지7. 성적 이의신청 포기원)을 제출하는 경우에 한하여 모든 고사가 끝난 후 7일(주말 및 공휴일 제외) 내에 발생하는 학교장 허가 교외체험학습을 허가할 수 있다. 또한 해당 기간 동안 미인정 결석자는 성적에 대한 이의 신청을 포기하는 것으로 간주한다.';

export function defaultParams(): WaiverParams {
    return {
        schoolName: '경성전자고등학교',
        round: '1',
        expStart: '2026년 11월 5일',
        expEnd: '11월 18일',
        expDays: '10',
        docDate: '2026년 11월 2일',
        regulation: DEFAULT_REGULATION,
    };
}

export interface WaiverStudent {
    grade: number;
    classNo: number;
    number: number;
    name: string;
}

export interface RosterError {
    line: number;
    text: string;
    reason: string;
}

export interface RosterResult {
    students: WaiverStudent[];
    errors: RosterError[];
}

/**
 * 학생 명단 붙여넣기 해석 (한 줄에 한 명, 엑셀 복사(탭)·쉼표·공백 모두 가능).
 *   3 4 8 박민혁 / 3,4,8,박민혁 / 3-4-8 박민혁 / 3학년 4반 8번 박민혁 / 30408 박민혁 / 박민혁 3 4 8
 */
export function parseRoster(text: string): RosterResult {
    const students: WaiverStudent[] = [];
    const errors: RosterError[] = [];
    const seen = new Set<string>();

    text.split(/\r?\n/).forEach((raw, idx) => {
        const line = raw.trim();
        if (!line) return;

        const stripped = line.replace(/학년|반|번호|번/g, ' ');
        const nameText = stripped.replace(/[0-9\-_.,/\t|:;()]/g, ' ').replace(/\s+/g, '');
        const digitGroups = stripped.match(/\d+/g) || [];

        // 헤더 줄(학년 반 번호 이름 등)은 조용히 건너뜀
        if (digitGroups.length === 0 && /^(이름|성명|학생|학생이름|학생명)?$/.test(nameText)) return;
        if (digitGroups.length === 0 && /(학년|번호)/.test(line) && /(이름|성명)/.test(line)) return;

        let grade: number | null = null;
        let classNo: number | null = null;
        let number: number | null = null;

        if (digitGroups.length >= 3) {
            [grade, classNo, number] = digitGroups.slice(0, 3).map(Number);
        } else if (digitGroups.length === 1 && digitGroups[0].length === 5) {
            const d = digitGroups[0];
            grade = Number(d.slice(0, 1));
            classNo = Number(d.slice(1, 3));
            number = Number(d.slice(3, 5));
        }

        if (grade === null || classNo === null || number === null) {
            errors.push({ line: idx + 1, text: line, reason: '학년·반·번호를 찾지 못했습니다' });
            return;
        }
        if (nameText.length < 2 || !/^[가-힣a-zA-Z]+$/.test(nameText)) {
            errors.push({ line: idx + 1, text: line, reason: '이름을 찾지 못했습니다' });
            return;
        }
        if (grade < 1 || grade > 6 || classNo < 1 || classNo > 99 || number < 1 || number > 99) {
            errors.push({ line: idx + 1, text: line, reason: '학년·반·번호 범위가 올바르지 않습니다' });
            return;
        }

        const key = `${grade}-${classNo}-${number}`;
        if (seen.has(key)) {
            errors.push({ line: idx + 1, text: line, reason: `${grade}학년 ${classNo}반 ${number}번이 중복됩니다` });
            return;
        }
        seen.add(key);
        students.push({ grade, classNo, number, name: nameText });
    });

    students.sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
    return { students, errors };
}

/** 서식처럼 글자 사이를 벌려 표시: 박민혁 → 박 민 혁 (5자 이상은 그대로) */
export function spacedName(name: string): string {
    return name.length <= 4 ? name.split('').join(' ') : name;
}

export function signLink(origin: string, requestId: string): string {
    return `${origin}/form-sign/${requestId}`;
}

export function isRole(v: unknown): v is WaiverRole {
    return v === 'student' || v === 'guardian';
}
