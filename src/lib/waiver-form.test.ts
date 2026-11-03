import { describe, it, expect } from 'vitest';
import { parseRoster, spacedName, isRole } from './waiver-form';

describe('parseRoster', () => {
    it('여러 입력 형식을 같은 학생으로 해석한다', () => {
        const forms = [
            '3 4 8 박민혁',
            '3,4,8,박민혁',
            '3-4-8 박민혁',
            '3학년 4반 8번 박민혁',
            '30408 박민혁',
            '박민혁 3 4 8',
            '3\t4\t8\t박 민 혁',
        ];
        for (const f of forms) {
            const r = parseRoster(f);
            expect(r.errors, f).toEqual([]);
            expect(r.students, f).toEqual([{ grade: 3, classNo: 4, number: 8, name: '박민혁' }]);
        }
    });

    it('헤더 줄은 건너뛰고 학년·반·번호 순으로 정렬한다', () => {
        const r = parseRoster('학년\t반\t번호\t이름\n3 4 9 김하늘\n3 4 8 박민혁\n3 2 1 이서준');
        expect(r.errors).toEqual([]);
        expect(r.students.map(s => s.name)).toEqual(['이서준', '박민혁', '김하늘']);
    });

    it('오류 줄과 중복을 보고한다', () => {
        const r = parseRoster('박민혁\n3 4 8 박민혁\n3 4 8 김하늘\n3 4 9 1');
        expect(r.students).toHaveLength(1);
        expect(r.errors.map(e => e.line)).toEqual([1, 3, 4]);
    });
});

describe('helpers', () => {
    it('spacedName', () => {
        expect(spacedName('박민혁')).toBe('박 민 혁');
        expect(spacedName('남궁민수영')).toBe('남궁민수영');
    });
    it('isRole', () => {
        expect(isRole('student')).toBe(true);
        expect(isRole('guardian')).toBe(true);
        expect(isRole('teacher')).toBe(false);
    });
});
