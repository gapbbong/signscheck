/**
 * SignsUp - Invincible GAS Connector
 * 
 * 역할을 명확히 분리:
 * 1. GET/POST 요청을 받아 시트 데이터를 읽거나 쓴다.
 * 2. 복잡한 로직은 수행하지 않는다.
 */

function doPost(e) {
    const lock = LockService.getScriptLock();
    // 동시성 제어를 위해 10초간 락 대기 (실패 시 에러)
    if (!lock.tryLock(10000)) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: 'Server is busy. Try again.'
        })).setMimeType(ContentService.MimeType.JSON);
    }

    try {
        const params = JSON.parse(e.postData.contents);
        const action = params.action;
        let result = {};

        switch (action) {
            case 'find_attendees':
                result = findAttendees(params.names);
                break;
            case 'update_status':
                result = updateSignatureStatus(params.phone, params.status);
                break;
            default:
                result = { error: 'Unknown action' };
        }

        return ContentService.createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    } finally {
        lock.releaseLock();
    }
}

/**
 * 이름 목록을 받아 전화번호를 찾아서 반환
 * @param {string[]} names - 찾을 이름 배열
 */
function findAttendees(names) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Members');
    // 데이터 최적화를 위해 전체 범위를 한 번에 읽음
    const data = sheet.getDataRange().getValues(); // [Name, Phone, ...]

    // 헤더 제외 (첫 줄이 헤더일 경우)
    const rows = data.slice(1);
    const found = [];

    names.forEach(name => {
        // 이름 매칭 로직 (동명이인 처리 로직은 추후 고도화 필요)
        const match = rows.find(row => row[0] == name); // Assuming Col A is Name
        if (match) {
            found.push({
                name: name,
                phone: match[1], // Assuming Col B is Phone
                confidence: 1.0 // 100% match
            });
        } else {
            found.push({
                name: name,
                phone: null,
                confidence: 0.0
            });
        }
    });

    return { status: 'success', data: found };
}

/**
 * 상태 업데이트 (서명 완료 표시)
 */
function updateSignatureStatus(phone, status) {
    // 로그 시트 등에 기록하는 로직 (To be implemented)
    return { status: 'success', message: 'Logged' };
}
