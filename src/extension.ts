import * as vscode from 'vscode';

// ============================================================================
// Глобальное состояние таймера и элементов UI
// ============================================================================
let workTimer: NodeJS.Timeout | undefined;
let breakTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;

// Временные интервалы (в миллисекундах)
const WORK_DURATION_MS = 40 * 60 * 1000; // 40 минут работы
const BREAK_DURATION_MS = 10 * 60 * 1000; // 10 минут перерыва

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
        vscode.window.showInformationMessage('Таймер работы запущен (40 минут).');
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
 * Запускает рабочий 40-минутный цикл.
 * Обновляет статус-бар и назначает уведомление об окончании работы.
 */
function startWorkTimer() {
    clearAllTimers();
    statusBarItem.text = "$(code) Работаем (40 мин)";

    workTimer = setTimeout(async () => {
        // Запрос действия у пользователя по истечении 40 минут
        const selection = await vscode.window.showWarningMessage(
            'Прошло 40 минут! Пора сделать перерыв на 10 минут.',
            'Начать перерыв',
            'Пропустить'
        );

        if (selection === 'Начать перерыв') {
            startBreakTimer();
        } else {
            // Если перерыв пропущен или окно закрыто — перезапускаем рабочий цикл
            startWorkTimer();
        }
    }, WORK_DURATION_MS);
}

/**
 * Запускает 10-минутный цикл перерыва.
 * Обновляет статус-бар и напоминает о возврате к работе.
 */
function startBreakTimer() {
    clearAllTimers();
    statusBarItem.text = "$(coffee) Перерыв (10 мин)";

    breakTimer = setTimeout(async () => {
        // Уведомление о завершении перерыва
        const selection = await vscode.window.showInformationMessage(
            'Перерыв 10 минут окончен! Пора возвращаться к работе.',
            'Вернуться к работе'
        );

        if (selection === 'Вернуться к работе' || selection === undefined) {
            startWorkTimer();
        }
    }, BREAK_DURATION_MS);
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