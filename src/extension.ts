import * as vscode from 'vscode';

// ============================================================================
// Глобальное состояние таймера, элементов UI и статистики
// ============================================================================
let workTimer: NodeJS.Timeout | undefined;
let breakTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;

// Накопленная статистика (в миллисекундах)
let totalWorkMs = 0;
let totalBreakMs = 0;

// Метки для отслеживания текущей сессии
let sessionStartTime: number | undefined;
let currentMode: 'work' | 'break' | 'stopped' = 'stopped';

/**
 * Получает длительность рабочего периода в миллисекундах из настроек VS Code.
 * По умолчанию: 40 минут.
 */
function getWorkDurationMs(): number {
    const config = vscode.workspace.getConfiguration('workTimer');
    const minutes = config.get<number>('workDuration', 40);
    return minutes * 60 * 1000;
}

/**
 * Получает длительность перерыва в миллисекундах из настроек VS Code.
 * По умолчанию: 10 минут.
 */
function getBreakDurationMs(): number {
    const config = vscode.workspace.getConfiguration('workTimer');
    const minutes = config.get<number>('breakDuration', 10);
    return minutes * 60 * 1000;
}

/**
 * Основная точка входа в расширение.
 * Вызывается VS Code при активации плагина.
 * @param context Контекст расширения для управления подписками и ресурсами
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('Расширение "Work Timer" успешно активировано');

    // --- Инициализация статус-бара ---
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // --- Регистрация пользовательских команд ---

    // 1. Запуск таймера вручную
    const startDisposable = vscode.commands.registerCommand('workTimer.start', () => {
        startWorkTimer();
        const minutes = Math.round(getWorkDurationMs() / (60 * 1000));
        vscode.window.showInformationMessage(`Таймер работы запущен (${minutes} мин).`);
    });

    // 2. Остановка таймера вручную
    const stopDisposable = vscode.commands.registerCommand('workTimer.stop', () => {
        stopTimerAndSaveStats();
        statusBarItem.text = "$(watch) Таймер остановлен";
        vscode.window.showInformationMessage('Таймер остановлен. Статистика сохранена.');
    });

    // 3. Просмотр собранной статистики
    const statsDisposable = vscode.commands.registerCommand('workTimer.showStats', () => {
        showStatistics();
    });

    // 4. Интерактивная настройка времени через диалоговые окна ввода
    const setDurationDisposable = vscode.commands.registerCommand('workTimer.setDuration', async () => {
        // Запрос времени работы
        const workInput = await vscode.window.showInputBox({
            prompt: 'Введите длительность работы в минутах',
            value: String(Math.round(getWorkDurationMs() / (60 * 1000))),
            validateInput: (value) => {
                const num = Number(value);
                return isNaN(num) || num <= 0 ? 'Введите число больше 0' : null;
            }
        });

        if (!workInput) {
            return;
        }

        // Запрос времени перерыва
        const breakInput = await vscode.window.showInputBox({
            prompt: 'Введите длительность перерыва в минутах',
            value: String(Math.round(getBreakDurationMs() / (60 * 1000))),
            validateInput: (value) => {
                const num = Number(value);
                return isNaN(num) || num <= 0 ? 'Введите число больше 0' : null;
            }
        });

        if (!breakInput) {
            return;
        }

        // Сохранение глобальных настроек в конфигурацию VS Code
        const config = vscode.workspace.getConfiguration('workTimer');
        await config.update('workDuration', Number(workInput), vscode.ConfigurationTarget.Global);
        await config.update('breakDuration', Number(breakInput), vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(`Настройки обновлены: Работа — ${workInput} мин, Перерыв — ${breakInput} мин.`);
        
        // Автоматический перезапуск таймера с новыми параметрами
        startWorkTimer();
    });

    // Регистрируем все команды в подписках для автоматической очистки
    context.subscriptions.push(startDisposable, stopDisposable, statsDisposable, setDurationDisposable);

    // Автоматический старт первого рабочего цикла при активации
    startWorkTimer();
}

/**
 * Запускает рабочий цикл на основе текущих настроек.
 * Обновляет статус-бар и фиксирует начало сессии.
 */
function startWorkTimer() {
    stopTimerAndSaveStats(); // Сохраняем прогресс предыдущего интервала
    currentMode = 'work';
    sessionStartTime = Date.now();

    const workMinutes = Math.round(getWorkDurationMs() / (60 * 1000));
    statusBarItem.text = `$(code) Работаем (${workMinutes} мин)`;

    workTimer = setTimeout(async () => {
        // Фиксируем отработанное время при успешном завершении интервала
        if (currentMode === 'work' && sessionStartTime) {
            totalWorkMs += Date.now() - sessionStartTime;
            sessionStartTime = undefined;
        }

        const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
        const selection = await vscode.window.showWarningMessage(
            `Прошло ${workMinutes} мин! Пора сделать перерыв на ${breakMinutes} мин.`,
            'Начать перерыв',
            'Пропустить'
        );

        if (selection === 'Начать перерыв') {
            startBreakTimer();
        } else {
            startWorkTimer();
        }
    }, getWorkDurationMs());
}

/**
 * Запускает цикл перерыва на основе настроек.
 * Обновляет статус-бар и напоминает о возврате к работе.
 */
function startBreakTimer() {
    stopTimerAndSaveStats();
    currentMode = 'break';
    sessionStartTime = Date.now();

    const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
    statusBarItem.text = `$(coffee) Перерыв (${breakMinutes} мин)`;

    breakTimer = setTimeout(async () => {
        if (currentMode === 'break' && sessionStartTime) {
            totalBreakMs += Date.now() - sessionStartTime;
            sessionStartTime = undefined;
        }

        const selection = await vscode.window.showInformationMessage(
            `Перерыв ${breakMinutes} мин окончен! Пора возвращаться к работе.`,
            'Вернуться к работе'
        );

        if (selection === 'Вернуться к работе' || selection === undefined) {
            startWorkTimer();
        }
    }, getBreakDurationMs());
}

/**
 * Останавливает активные таймеры и фиксирует прошедшее время текущей незавершенной сессии.
 */
function stopTimerAndSaveStats() {
    if (sessionStartTime && currentMode !== 'stopped') {
        const elapsed = Date.now() - sessionStartTime;
        if (currentMode === 'work') {
            totalWorkMs += elapsed;
        } else if (currentMode === 'break') {
            totalBreakMs += elapsed;
        }
        sessionStartTime = undefined;
    }

    if (workTimer) {
        clearTimeout(workTimer);
        workTimer = undefined;
    }
    if (breakTimer) {
        clearTimeout(breakTimer);
        breakTimer = undefined;
    }
    currentMode = 'stopped';
}

/**
 * Вычисляет и выводит общую статистику работы и отдыха в информационное окно.
 */
function showStatistics() {
    let activeWork = totalWorkMs;
    let activeBreak = totalBreakMs;

    // Учитываем текущую активную незавершенную сессию «на лету»
    if (sessionStartTime && currentMode !== 'stopped') {
        const elapsed = Date.now() - sessionStartTime;
        if (currentMode === 'work') {
            activeWork += elapsed;
        } else if (currentMode === 'break') {
            activeBreak += elapsed;
        }
    }

    const workMins = (activeWork / (60 * 1000)).toFixed(1);
    const breakMins = (activeBreak / (60 * 1000)).toFixed(1);

    vscode.window.showInformationMessage(
        `📊 Статистика таймера:\n• Отработано: ${workMins} мин.\n• Отдых: ${breakMins} мин.`
    );
}

/**
 * Точка деактивации расширения.
 * Вызывается при закрытии VS Code или выгрузке плагина.
 */
export function deactivate() {
    stopTimerAndSaveStats();
    console.log('Расширение "Work Timer" деактивировано');
}