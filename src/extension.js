"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
// ============================================================================
// Глобальное состояние таймера, элементов UI и статистики
// ============================================================================
let workTimer;
let breakTimer;
let statusBarItem;
let globalContext;
// Ключи для постоянного сохранения данных в глобальном хранилище VS Code (globalState)
const STORAGE_KEY_WORK = 'workTimer.totalWorkMs';
const STORAGE_KEY_BREAK = 'workTimer.totalBreakMs';
// Метки для отслеживания текущего состояния сессии и подсчета времени «на лету»
let sessionStartTime;
let currentMode = 'stopped';
/**
 * Получает длительность рабочего периода в миллисекундах из настроек конфигурации VS Code.
 * По умолчанию: 40 минут.
 */
function getWorkDurationMs() {
    const config = vscode.workspace.getConfiguration('workTimer');
    const minutes = config.get('workDuration', 40);
    return minutes * 60 * 1000;
}
/**
 * Получает длительность перерыва в миллисекундах из настроек конфигурации VS Code.
 * По умолчанию: 10 минут.
 */
function getBreakDurationMs() {
    const config = vscode.workspace.getConfiguration('workTimer');
    const minutes = config.get('breakDuration', 10);
    return minutes * 60 * 1000;
}
/**
 * Основная точка входа в расширение (вызывается при активации плагина).
 * @param context Контекст расширения, предоставляемый VS Code для управления подписками и состоянием.
 */
function activate(context) {
    globalContext = context;
    console.log('Расширение "Work Timer" успешно активировано');
    // --- Инициализация статус-бара ---
    // Создаем элемент справа в статус-баре и привязываем к нему команду открытия меню
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'workTimer.menu';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    // --- Регистрация пользовательских команд ---
    // 1. Интерактивное меню (вызывается кликом по статус-бару)
    const menuDisposable = vscode.commands.registerCommand('workTimer.menu', async () => {
        const action = await vscode.window.showQuickPick([
            { label: '$(play) Запустить / Перезапустить таймер', id: 'start' },
            { label: '$(debug-pause) Остановить таймер', id: 'stop' },
            { label: '$(coffee) Сделать перерыв сейчас', id: 'break' },
            { label: '$(graph) Показать статистику', id: 'stats' },
            { label: '$(gear) Настроить время (работа/перерыв)', id: 'config' },
            { label: '$(trash) Сбросить сохраненную статистику', id: 'resetStats' }
        ], { placeHolder: 'Выберите действие с таймером' });
        if (!action) {
            return;
        }
        // Маршрутизация действий пользователя из выпадающего списка
        switch (action.id) {
            case 'start':
                startWorkTimer();
                vscode.window.showInformationMessage('Таймер работы запущен.');
                break;
            case 'stop':
                stopTimerAndSaveStats();
                statusBarItem.text = "$(watch) Таймер остановлен";
                vscode.window.showInformationMessage('Таймер остановлен. Статистика сохранена.');
                break;
            case 'break':
                startBreakTimer();
                vscode.window.showInformationMessage('Перерыв принудительно запущен.');
                break;
            case 'stats':
                showStatistics();
                break;
            case 'config':
                vscode.commands.executeCommand('workTimer.setDuration');
                break;
            case 'resetStats':
                await resetStatistics();
                break;
        }
    });
    // 2. Ручной запуск таймера из палитры команд
    const startDisposable = vscode.commands.registerCommand('workTimer.start', () => {
        startWorkTimer();
        const minutes = Math.round(getWorkDurationMs() / (60 * 1000));
        vscode.window.showInformationMessage(`Таймер работы запущен (${minutes} мин).`);
    });
    // 3. Ручная остановка таймера
    const stopDisposable = vscode.commands.registerCommand('workTimer.stop', () => {
        stopTimerAndSaveStats();
        statusBarItem.text = "$(watch) Таймер остановлен";
        vscode.window.showInformationMessage('Таймер остановлен. Статистика сохранена.');
    });
    // 4. Просмотр статистики
    const statsDisposable = vscode.commands.registerCommand('workTimer.showStats', () => {
        showStatistics();
    });
    // 5. Настройка длительности интервалов через диалоговые окна ввода
    const setDurationDisposable = vscode.commands.registerCommand('workTimer.setDuration', async () => {
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
        // Сохранение параметров в глобальную конфигурацию VS Code
        const config = vscode.workspace.getConfiguration('workTimer');
        await config.update('workDuration', Number(workInput), vscode.ConfigurationTarget.Global);
        await config.update('breakDuration', Number(breakInput), vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Настройки обновлены: Работа — ${workInput} мин, Перерыв — ${breakInput} мин.`);
        startWorkTimer();
    });
    // Регистрируем все созданные команды в контексте для автоматической очистки
    context.subscriptions.push(menuDisposable, startDisposable, stopDisposable, statsDisposable, setDurationDisposable);
    // Автоматический запуск рабочего процесса при активации расширения
    startWorkTimer();
}
/**
 * Запускает рабочий цикл таймера.
 * @param customDurationMs Опциональный параметр для кастомной длительности (используется при отсрочке).
 */
function startWorkTimer(customDurationMs) {
    stopTimerAndSaveStats(); // Сохраняем прогресс предыдущего интервала перед стартом нового
    currentMode = 'work';
    sessionStartTime = Date.now();
    const durationMs = customDurationMs ?? getWorkDurationMs();
    const workMinutes = Math.round(durationMs / (60 * 1000));
    // Обновляем текст в статус-баре
    statusBarItem.text = customDurationMs
        ? `$(code) Работаем (отсрочка ${workMinutes} мин)`
        : `$(code) Работаем (${workMinutes} мин)`;
    workTimer = setTimeout(async () => {
        // По завершении таймера фиксируем отработанное время
        if (currentMode === 'work' && sessionStartTime) {
            addWorkTime(Date.now() - sessionStartTime);
            sessionStartTime = undefined;
        }
        const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
        // Показываем предупреждение с действиями на выбор
        const selection = await vscode.window.showWarningMessage(`Время работы (${workMinutes} мин) подошло к концу! Пора сделать перерыв на ${breakMinutes} мин.`, 'Начать перерыв', 'Отложить на 5 мин', 'Пропустить');
        if (selection === 'Начать перерыв') {
            startBreakTimer();
        }
        else if (selection === 'Отложить на 5 мин') {
            startWorkTimer(5 * 60 * 1000); // Перезапуск работы на 5 минут
        }
        else {
            startWorkTimer(); // Пропуск перерыва и старт новой рабочей сессии
        }
    }, durationMs);
}
/**
 * Запускает цикл перерыва.
 */
function startBreakTimer() {
    stopTimerAndSaveStats();
    currentMode = 'break';
    sessionStartTime = Date.now();
    const breakMinutes = Math.round(getBreakDurationMs() / (60 * 1000));
    statusBarItem.text = `$(coffee) Перерыв (${breakMinutes} мин)`;
    breakTimer = setTimeout(async () => {
        if (currentMode === 'break' && sessionStartTime) {
            addBreakTime(Date.now() - sessionStartTime);
            sessionStartTime = undefined;
        }
        const selection = await vscode.window.showInformationMessage(`Перерыв ${breakMinutes} мин окончен! Пора возвращаться к работе.`, 'Вернуться к работе');
        if (selection === 'Вернуться к работе' || selection === undefined) {
            startWorkTimer();
        }
    }, getBreakDurationMs());
}
/**
 * Добавляет указанное количество миллисекунд к общему рабочему времени в globalState.
 */
function addWorkTime(ms) {
    const current = globalContext.globalState.get(STORAGE_KEY_WORK, 0);
    globalContext.globalState.update(STORAGE_KEY_WORK, current + ms);
}
/**
 * Добавляет указанное количество миллисекунд ко времени перерыва в globalState.
 */
function addBreakTime(ms) {
    const current = globalContext.globalState.get(STORAGE_KEY_BREAK, 0);
    globalContext.globalState.update(STORAGE_KEY_BREAK, current + ms);
}
/**
 * Останавливает все активные таймеры и сохраняет текущую незавершенную сессию в хранилище.
 */
function stopTimerAndSaveStats() {
    if (sessionStartTime && currentMode !== 'stopped') {
        const elapsed = Date.now() - sessionStartTime;
        if (currentMode === 'work') {
            addWorkTime(elapsed);
        }
        else if (currentMode === 'break') {
            addBreakTime(elapsed);
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
 * Полностью сбрасывает сохраненную в globalState статистику.
 */
async function resetStatistics() {
    await globalContext.globalState.update(STORAGE_KEY_WORK, 0);
    await globalContext.globalState.update(STORAGE_KEY_BREAK, 0);
    vscode.window.showInformationMessage('📊 Статистика таймера успешно сброшена.');
}
/**
 * Вычисляет и выводит общую накопленную статистику (включая активную текущую сессию).
 */
function showStatistics() {
    let activeWork = globalContext.globalState.get(STORAGE_KEY_WORK, 0);
    let activeBreak = globalContext.globalState.get(STORAGE_KEY_BREAK, 0);
    // Учитываем время текущей незавершенной сессии «на лету»
    if (sessionStartTime && currentMode !== 'stopped') {
        const elapsed = Date.now() - sessionStartTime;
        if (currentMode === 'work') {
            activeWork += elapsed;
        }
        else if (currentMode === 'break') {
            activeBreak += elapsed;
        }
    }
    const workMins = (activeWork / (60 * 1000)).toFixed(1);
    const breakMins = (activeBreak / (60 * 1000)).toFixed(1);
    vscode.window.showInformationMessage(`📊 Накопленная статистика:\n• Отработано: ${workMins} мин.\n• Отдых: ${breakMins} мин.`);
}
/**
 * Точка деактивации расширения (вызывается при закрытии редактора или выгрузке плагина).
 */
function deactivate() {
    stopTimerAndSaveStats();
    console.log('Расширение "Work Timer" деактивировано');
}
//# sourceMappingURL=extension.js.map