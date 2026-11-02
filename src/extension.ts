import * as vscode from 'vscode';

// ============================================================================
// Глобальное состояние таймера и элементов UI
// ============================================================================
let workTimer: NodeJS.Timeout | undefined;
let breakTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;

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

    // Запуск таймера вручную
    const startDisposable = vscode.commands.registerCommand('workTimer.start', () => {
        startWorkTimer();
        const minutes = Math.round(getWorkDurationMs() / (60 * 1000));
        vscode.window.showInformationMessage(`Таймер работы запущен (${minutes} мин).`);
    });

    // Остановка таймера вручную
    const stopDisposable = vscode.commands.registerCommand('workTimer.stop', () => {
        clearAllTimers();
        statusBarItem.text = "$(watch) Таймер остановлен";
        vscode.window.showInformationMessage('Таймер остановлен.');
    });

    // Регистрируем команды в подписках для автоматической очистки при деактивации
    context.subscriptions.push(startDisposable, stopDisposable);

    // Автоматический старт первого рабочего цикла при запуске расширения
    startWorkTimer();
}

/**
 * Запускает рабочий цикл на основе настроек.
 * Обновляет статус-бар и назначает уведомление об окончании работы.
 */
function startWorkTimer() {
    clearAllTimers();
    const workMinutes = Math.round(getWorkDurationMs() / (60 * 1000));
    statusBarItem.text = `$(code) Работаем (${workMinutes} мин)`;

    workTimer = setTimeout(async () => {
        const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
        // Запрос действия у пользователя по истечении времени
        const selection = await vscode.window.showWarningMessage(
            `Прошло ${workMinutes} мин! Пора сделать перерыв на ${breakMinutes} мин.`,
            'Начать перерыв',
            'Пропустить'
        );

        if (selection === 'Начать перерыв') {
            startBreakTimer();
        } else {
            // Если перерыв пропущен или окно закрыто — перезапускаем рабочий цикл
            startWorkTimer();
        }
    }, getWorkDurationMs());
}

/**
 * Запускает цикл перерыва на основе настроек.
 * Обновляет статус-бар и напоминает о возврате к работе.
 */
function startBreakTimer() {
    clearAllTimers();
    const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
    statusBarItem.text = `$(coffee) Перерыв (${breakMinutes} мин)`;

    breakTimer = setTimeout(async () => {
        // Уведомление о завершении перерыва
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
 * Вспомогательная функция для сброса активных Node.js таймеров.
 * Предотвращает утечки памяти и наложение интервалов друг на друга.
 */
function clearAllTimers() {
    if (workTimer) {
        clearTimeout(workTimer);
        workTimer = undefined;
    }
    if (breakTimer) {
        clearTimeout(breakTimer);
        breakTimer = undefined;
    }
}

/**
 * Точка деактивации расширения.
 * Вызывается при закрытии VS Code или отключении плагина.
 */
export function deactivate() {
    clearAllTimers();
    console.log('Расширение "Work Timer" деактивировано');
}