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
 */
function getWorkDurationMs(): number {
    const config = vscode.workspace.getConfiguration('workTimer');
    const minutes = config.get<number>('workDuration', 40);
    return minutes * 60 * 1000;
}

/**
 * Получает длительность перерыва в миллисекундах из настроек VS Code.
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

    // Запуск таймера вручную
    const startDisposable = vscode.commands.registerCommand('workTimer.start', () => {
        startWorkTimer();
        const minutes = Math.round(getWorkDurationMs() / (60 * 1000));
        vscode.window.showInformationMessage(`Таймер работы запущен (${minutes} мин).`);
    });

    // Остановка таймера вручную
    const stopDisposable = vscode.commands.registerCommand('workTimer.stop', () => {
        stopTimerAndSaveStats();
        statusBarItem.text = "$(watch) Таймер остановлен";
        vscode.window.showInformationMessage('Таймер остановлен. Статистика сохранена.');
    });

    // Показ статистики
    const statsDisposable = vscode.commands.registerCommand('workTimer.showStats', () => {
        showStatistics();
    });

    // Регистрируем команды в подписках для автоматической очистки при деактивации
    context.subscriptions.push(startDisposable, stopDisposable, statsDisposable);

    // Автоматический старт первого рабочего цикла при запуске расширения
    startWorkTimer();
}

/**
 * Запускает рабочий цикл на основе настроек.
 */
function startWorkTimer() {
    stopTimerAndSaveStats(); // Сохраняем предыдущий прогресс, если был активен другой режим
    currentMode = 'work';
    sessionStartTime = Date.now();

    const workMinutes = Math.round(getWorkDurationMs() / (60 * 1000));
    statusBarItem.text = `$(code) Работаем (${workMinutes} мин)`;

    workTimer = setTimeout(async () => {
        // Если цикл завершился полностью, фиксируем отработанное время
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
 * Останавливает активные таймеры и дописывает прошедшее время текущей сессии в статистику.
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
 * Выводит общую статистику работы и отдыха в информационное окно.
 */
function showStatistics() {
    // Если сессия идет прямо сейчас, учитываем её текущий прогресс для отображения
    let activeWork = totalWorkMs;
    let activeBreak = totalBreakMs;

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
 */
export function deactivate() {
    stopTimerAndSaveStats();
    console.log('Расширение "Work Timer" деактивировано');
}