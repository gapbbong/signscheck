"use client";

import React from 'react';
import { WaiverParams, WaiverStudent, WaiverRole, spacedName } from '@/lib/waiver-form';

interface Props {
    params: WaiverParams;
    student: WaiverStudent;
    studentSignature?: string | null;
    guardianSignature?: string | null;
    guardianName?: string | null;
    /** 지금 서명해야 하는 칸을 강조 */
    highlight?: WaiverRole | null;
}

/**
 * 성적 이의신청 포기원 본문. 서명 칸 위치는 이 컴포넌트가 직접 정하므로
 * PDF 좌표 추정이 필요 없다. 서명은 각 "(서명)" 글자 바로 앞 칸에 들어간다.
 */
export default function WaiverDocument({ params, student, studentSignature, guardianSignature, guardianName, highlight }: Props) {
    const slot = (role: WaiverRole, src?: string | null) => (
        <span
            data-sign-slot={role}
            style={{
                position: 'relative',
                display: 'inline-block',
                width: '7.5em',
                height: '2.6em',
                verticalAlign: 'middle',
                margin: '0 0.3em',
                borderBottom: '1px solid #475569',
                outline: highlight === role && !src ? '2px dashed #10b981' : 'none',
                outlineOffset: '2px',
                borderRadius: '2px',
                background: highlight === role && !src ? 'rgba(16,185,129,0.08)' : 'transparent',
            }}
        >
            {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={src}
                    alt={`${role === 'student' ? '학생' : '보호자'} 서명`}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                />
            )}
        </span>
    );

    return (
        <div
            className="waiver-doc"
            style={{
                background: '#fff',
                color: '#0f172a',
                fontFamily: '"Malgun Gothic","Noto Sans KR","Apple SD Gothic Neo",sans-serif',
                lineHeight: 1.7,
                fontSize: '0.95rem',
                padding: 'clamp(1rem, 4vw, 2.5rem)',
                border: '1px solid #cbd5e1',
                borderRadius: '0.5rem',
                wordBreak: 'keep-all',
            }}
        >
            <h2 style={{ textAlign: 'center', fontSize: '1.6em', fontWeight: 800, letterSpacing: '0.08em', margin: '0 0 1.5rem' }}>
                성적 이의신청 포기원
            </h2>

            <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
                <div>{student.grade}학년 {student.classNo}반 {student.number}번</div>
                <div>성 명 : {spacedName(student.name)}</div>
            </div>

            <p style={{ margin: '0 0 1rem' }}>
                본인은 ( {params.round} )차 정기시험 결과에 대한 이의 신청을 포기하고, 이로 인해 발생할 수 있는 제반 사항에 대해 이의제기를 하지 않겠습니다.
            </p>

            <div style={{ border: '1px solid #94a3b8', padding: '0.75rem 1rem', fontSize: '0.88em', margin: '0 0 1rem', background: '#f8fafc' }}>
                [관련 규정: {params.regulation}]
            </div>

            <p style={{ margin: '0.2rem 0' }}>■ 성적 이의 신청 기간 : 모든 ( {params.round} )차 정기시험이 끝난 후 7일간(주말 및 공휴일 제외)</p>
            <p style={{ margin: '0.2rem 0 1.5rem' }}>■ 교외체험학습 신청 기간 : {params.expStart} ~ {params.expEnd} ( {params.expDays}일간)</p>

            <p style={{ textAlign: 'center', margin: '0 0 1.5rem' }}>{params.docDate}</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
                <div>학생 성명 : <b>{spacedName(student.name)}</b> {slot('student', studentSignature)}(서명)</div>
                <div>
                    보호자 성명 : {guardianName ? <b>{guardianName}</b> : <span style={{ display: 'inline-block', minWidth: '5em' }} />}
                    {slot('guardian', guardianSignature)}(서명)
                </div>
            </div>

            <p style={{ fontWeight: 700, margin: 0 }}>{params.schoolName}장 귀하</p>
        </div>
    );
}
