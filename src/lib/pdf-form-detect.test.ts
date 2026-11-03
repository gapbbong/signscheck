import { describe, it, expect } from 'vitest';
import gajeong from './__fixtures__/pdfform-gajeong.json';
import result from './__fixtures__/pdfform-result.json';
import { detectFormLayout, extractIdentity, applyNudges, buildLines, FormField, SignField, ChoiceField, TextField } from './pdf-form-detect';

// 두 fixture는 실제 학교 서식 PDF(가정통신문, 교외체험학습 결과보고서)의 글자 좌표(pdftotext -bbox)이다.
const near = (a: number, b: number, tol = 3) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const get = <T extends FormField>(fields: FormField[], id: string) => fields.find(f => f.id === id) as T;

describe('가정통신문 (학생 전원 동일 문서)', () => {
    const layout = detectFormLayout(gajeong.items, gajeong.pageWidth, gajeong.pageHeight);

    it('학생·보호자 서명 칸을 "(인)" 앞 빈칸에서 찾는다', () => {
        const s = get<SignField>(layout.fields, 'sign-student');
        const g = get<SignField>(layout.fields, 'sign-guardian');
        // 빈칸은 ":"(x≈427)와 "(인)"(x≈520) 사이
        expect(s.x).toBeGreaterThan(427);
        expect(s.x + s.w).toBeLessThan(520);
        near(s.y + s.h / 2, 651.5);
        near(g.y + g.h / 2, 669.5);
        expect(g.y).toBeGreaterThan(s.y);
    });

    it('참여/불참 칸의 중앙을 표 데이터 행에서 찾는다', () => {
        const c = get<ChoiceField>(layout.fields, 'choice');
        near(c.options[0].cx, 297, 6);
        near(c.options[1].cx, 456, 6);
        near(c.options[0].cy, 603, 4);
    });

    it('학번·성명·월·일 빈칸 위치를 찾는다', () => {
        const t = (id: string) => get<TextField>(layout.fields, id);
        near(t('text-studentNo').x, 331, 4);
        near(t('text-name').x, 448, 4);
        near(t('text-studentNo').cy, 517, 3);
        near(t('text-month').x, 296, 4);
        near(t('text-day').x, 320, 4);
        near(t('text-month').cy, 636, 3);
    });
});

describe('교외체험학습 결과보고서 (학생별 문서)', () => {
    const layout = detectFormLayout(result.items, result.pageWidth, result.pageHeight);

    it('이름이 이미 찍힌 줄에서는 "(인)" 끝에 맞춰 도장처럼 찍는다', () => {
        const s = get<SignField>(layout.fields, 'sign-student');
        const g = get<SignField>(layout.fields, 'sign-guardian');
        near(s.x + s.w, 518.8, 3); // "(인)" 오른쪽 끝(516.8) 근처
        near(s.y + s.h / 2, 648.8);
        near(g.y + g.h / 2, 634.8);
    });

    it('참여/불참, 학번 칸은 없다 (서명만 받는 서식)', () => {
        expect(layout.fields.some(f => f.kind === 'choice' || f.kind === 'text')).toBe(false);
    });

    it('PDF 안의 성명과 학년·반·번호로 학생을 식별한다', () => {
        expect(extractIdentity(result.items)).toEqual({ name: '홍길동', grade: 3, classNo: 4, number: 9 });
    });
});

describe('helpers', () => {
    it('applyNudges는 지정한 칸만 움직인다', () => {
        const layout = detectFormLayout(gajeong.items, gajeong.pageWidth, gajeong.pageHeight);
        const moved = applyNudges(layout, { 'sign-student': { dx: 4, dy: -2 }, choice: { dx: 1, dy: 1 } });
        const a = get<SignField>(layout.fields, 'sign-student'), b = get<SignField>(moved.fields, 'sign-student');
        expect([b.x - a.x, b.y - a.y]).toEqual([4, -2]);
        const g0 = get<SignField>(layout.fields, 'sign-guardian'), g1 = get<SignField>(moved.fields, 'sign-guardian');
        expect([g1.x, g1.y]).toEqual([g0.x, g0.y]);
        const c0 = get<ChoiceField>(layout.fields, 'choice'), c1 = get<ChoiceField>(moved.fields, 'choice');
        expect(c1.options[0].cx - c0.options[0].cx).toBe(1);
    });

    it('글자가 조각나 있어도 한 줄로 합친다', () => {
        const lines = buildLines([
            { str: '학', x: 10, y: 100, w: 8, h: 10 }, { str: '생', x: 22, y: 100, w: 8, h: 10 }, { str: ':', x: 31, y: 103, w: 3, h: 7 },
        ]);
        expect(lines).toHaveLength(1);
        expect(lines[0].compact).toBe('학생:');
    });
});
