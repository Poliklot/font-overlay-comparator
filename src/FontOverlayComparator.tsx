import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type ReactNode } from "react";

// === Font Overlay Comparator (Pure Frontend) ===
// Особенности:
// - Загрузка двух локальных шрифтов (ttf/otf/woff/woff2) через File Input или DnD
// - Наложение текста на canvas: красный (A) + циан (B) или режим Difference
// - Настройки: текст, размер, смещение по X/Y, трекинг (межбуквенный интервал), толщина линии
// - Просмотр по символам (grid) для выбранного набора
// - Замер ширины строки для A/B + разница
// - Экспорт результата в PNG
// Вся логика — на клиенте. Никакого бэкенда.

type OverlayMode = "red-cyan" | "difference";
type GridPreset = "basic-latin" | "caps" | "lower" | "digits" | "punct" | "custom";
type SlotLabel = "A" | "B";

interface LoadedFont {
  name: string;
  displayName: string;
  face: FontFace;
}

interface Msg {
  id: number;
  msg: string;
}

export default function FontOverlayComparator() {
  const [fontA, setFontA] = useState<LoadedFont | null>(null); // { name, displayName, face }
  const [fontB, setFontB] = useState<LoadedFont | null>(null);
  const [text, setText] = useState<string>("Hamburgefonstiv 0123456789 ABCD abcd");
  const [fontSize, setFontSize] = useState<number>(120);
  const [letterSpacing, setLetterSpacing] = useState<number>(0); // px
  const [dx, setDx] = useState<number>(0); // смещение B
  const [dy, setDy] = useState<number>(0);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("red-cyan"); // 'red-cyan' | 'difference'
  const [showChecker, setShowChecker] = useState<boolean>(true);
  const [stroke, setStroke] = useState<boolean>(false);
  const [strokeWidth, setStrokeWidth] = useState<number>(1);
  const [gridOpen, setGridOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false); // подсветка Drop-зоны
  const dragCounter = useRef<number>(0);
  const [gridCharsPreset, setGridCharsPreset] = useState<GridPreset>("basic-latin");
  const [customChars, setCustomChars] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const supported: boolean = typeof window !== "undefined" && ("FontFace" in window);

  const gridChars = useMemo<string>(() => {
    switch (gridCharsPreset) {
      case "caps":
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      case "lower":
        return "abcdefghijklmnopqrstuvwxyz";
      case "digits":
        return "0123456789";
      case "punct":
        return ".,;:!?()[]{}-—_";
      case "custom":
        return customChars || "";
      case "basic-latin":
      default:
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    }
  }, [gridCharsPreset, customChars]);

  useEffect(() => {
    drawCanvas();
  }, [fontA, fontB, text, fontSize, letterSpacing, dx, dy, overlayMode, showChecker, stroke, strokeWidth]);

  // Глобально предотвращаем открытие файла браузером при перетаскивании
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener('dragover', prevent as EventListener);
    return () => {
      window.removeEventListener('dragover', prevent as EventListener);
    };
  }, []);

  async function loadFontFromFile(file: File, label: SlotLabel): Promise<LoadedFont | null> {
    try {
      const ab = await file.arrayBuffer();
      const uniqueName = `${label}_${file.name.replace(/\W+/g, "_")}_${Date.now()}`;
      const face = new FontFace(uniqueName, ab);
      const loaded = await face.load();
      document.fonts.add(loaded);
      return { name: uniqueName, displayName: file.name, face: loaded };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      pushMessage(`Не удалось загрузить шрифт ${file.name}: ${errMsg}`);
      return null;
    }
  }

  function pushMessage(msg: string): void {
    setMessages((arr: Msg[]) => [{ id: Date.now() + Math.random(), msg }, ...arr].slice(0, 5));
  }

  function humanDevicePixelRatio(): number {
    const dpr = window.devicePixelRatio || 1;
    // ограничим до 2, чтобы не раздувать память
    return Math.min(2, Math.max(1, dpr));
  }

  function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number, size: number = 16): void {
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        const on = ((x / size) + (y / size)) % 2 === 0;
        ctx.fillStyle = on ? "#eee" : "#fff";
        ctx.fillRect(x, y, size, size);
      }
    }
  }

  function drawString(
    ctx: CanvasRenderingContext2D,
    fontName: string,
    content: string,
    x: number,
    y: number,
    color: string,
    _letterSpacing: number,
    _stroke: boolean,
    _strokeWidth: number
  ): void {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = _strokeWidth;
    ctx.font = `${fontSize}px "${fontName}"`;
    ctx.textBaseline = "alphabetic";
    ctx.fontKerning = "normal";

    if (!_letterSpacing) {
      if (_stroke) ctx.strokeText(content, x, y);
      ctx.fillText(content, x, y);
      return;
    }
    // Рисуем посимвольно при letterSpacing>0
    let cx = x;
    for (const ch of content) {
      if (_stroke) ctx.strokeText(ch, cx, y);
      ctx.fillText(ch, cx, y);
      const m = ctx.measureText(ch);
      cx += (m.width || 0) + _letterSpacing;
    }
  }

  function measureString(
    ctx: CanvasRenderingContext2D,
    fontName: string,
    content: string,
    _letterSpacing: number
  ): number {
    ctx.font = `${fontSize}px "${fontName}"`;
    const m = ctx.measureText(content);
    if (!_letterSpacing) return m.width;
    // примитивная оценка для letterSpacing>0
    let w = 0;
    for (const ch of content) {
      w += ctx.measureText(ch).width + _letterSpacing;
    }
    return w;
  }

  function drawCanvas(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pad = 32;
    const dpr = humanDevicePixelRatio();

    // временный расчёт ширины/высоты
    let w = 800, h = Math.max(200, fontSize * 1.8 + pad * 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // фон
    ctx.clearRect(0, 0, w, h);
    if (showChecker) drawChecker(ctx, w, h, 16);

    if (!fontA || !fontB) {
      ctx.fillStyle = "#999";
      ctx.font = `16px system-ui, sans-serif`;
      ctx.fillText("Загрузите два шрифта, чтобы начать сравнение.", 24, 40);
      return;
    }

    // точный расчёт ширины с учётом текста/шрифтов
    const tmp = document.createElement("canvas").getContext("2d");
    if (!tmp) return;
    const wA = measureString(tmp, fontA.name, text, letterSpacing);
    const wB = measureString(tmp, fontB.name, text, letterSpacing);
    w = Math.max(320, Math.ceil(Math.max(wA, wB) + pad * 2));
    h = Math.max(120, Math.ceil(fontSize * 1.8 + pad * 2));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (showChecker) drawChecker(ctx, w, h, 16); else ctx.clearRect(0, 0, w, h);

    const x = pad;
    const y = h - pad - Math.round((h - fontSize) / 4); // приятная посадка по базовой линии

    // Рисуем A
    if (overlayMode === "difference") {
      // В режиме difference: первый слой как есть (белый), второй — с композицией difference
      drawString(ctx, fontA.name, text, x, y, "#ffffff", letterSpacing, stroke, strokeWidth);
      ctx.globalCompositeOperation = "difference";
      drawString(ctx, fontB.name, text, x + dx, y + dy, "#ffffff", letterSpacing, stroke, strokeWidth);
      ctx.globalCompositeOperation = "source-over";
    } else {
      // Классика: A — красный, B — циан
      drawString(ctx, fontA.name, text, x, y, "rgba(255,0,0,0.85)", letterSpacing, stroke, strokeWidth);
      drawString(ctx, fontB.name, text, x + dx, y + dy, "rgba(0,255,255,0.85)", letterSpacing, stroke, strokeWidth);
    }

    // Базовая линия
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, y + 0.5);
    ctx.lineTo(w - 8, y + 0.5);
    ctx.stroke();

    // Подписи
    ctx.font = `14px system-ui, sans-serif`;
    ctx.fillStyle = "#111";
    ctx.fillText(`A: ${fontA.displayName}`, 12, h - 8);
    ctx.fillText(`B: ${fontB.displayName}`, w / 2, h - 8);
  }

  async function onDrop(e: ReactDragEvent<HTMLElement>): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    const fontFiles = files.filter((f) => /\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/.test(f.name));
    if (fontFiles.length === 0) {
      pushMessage('Файлы не распознаны как шрифты (.ttf/.otf/.woff/.woff2)');
      return;
    }
    if (!fontA) {
      const a = await loadFontFromFile(fontFiles[0], 'A');
      if (a) setFontA(a);
      if (fontFiles[1]) {
        const b = await loadFontFromFile(fontFiles[1], 'B');
        if (b) setFontB(b);
      }
    } else if (!fontB) {
      const b = await loadFontFromFile(fontFiles[0], 'B');
      if (b) setFontB(b);
    } else {
      pushMessage('Оба слота заняты. Сначала очистите один из шрифтов.');
    }
  }

  function onDragOver(e: ReactDragEvent<HTMLElement>): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }
  function onDragEnter(e: ReactDragEvent<HTMLElement>): void {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  }
  function onDragLeave(e: ReactDragEvent<HTMLElement>): void {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setIsDragging(false);
  }

  async function handleFilePick(e: ChangeEvent<HTMLInputElement>, which: SlotLabel): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    const loaded = await loadFontFromFile(file, which);
    if (!loaded) return;
    if (which === "A") setFontA(loaded); else setFontB(loaded);
  }

  function exportPNG(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `font-diff_${Date.now()}.png`;
    a.click();
  }

  function reset(which: SlotLabel): void {
    if (which === "A") setFontA(null);
    else if (which === "B") setFontB(null);
  }

  // Рендер ячеек для грида символов
  function GlyphCell({ ch }: { ch: string }) {
    const cellRef = useRef<HTMLCanvasElement | null>(null);
    useEffect(() => {
      const canvas = cellRef.current;
      if (!canvas || !fontA || !fontB) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = 120, h = 120; // фиксировано для стабильности
      const dpr = humanDevicePixelRatio();
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (showChecker) drawChecker(ctx, w, h, 12); else ctx.clearRect(0, 0, w, h);
      const x = Math.floor(w / 2);
      const y = Math.floor(h * 0.65);
      (ctx as CanvasRenderingContext2D).textAlign = "center";
      if (overlayMode === "difference") {
        drawString(ctx, fontA.name, ch, x, y, "#ffffff", letterSpacing, stroke, strokeWidth);
        ctx.globalCompositeOperation = "difference";
        drawString(ctx, fontB.name, ch, x + dx, y + dy, "#ffffff", letterSpacing, stroke, strokeWidth);
        ctx.globalCompositeOperation = "source-over";
      } else {
        drawString(ctx, fontA.name, ch, x, y, "rgba(255,0,0,0.85)", letterSpacing, stroke, strokeWidth);
        drawString(ctx, fontB.name, ch, x + dx, y + dy, "rgba(0,255,255,0.85)", letterSpacing, stroke, strokeWidth);
      }
      // baseline
      ctx.strokeStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath();
      ctx.moveTo(8, y + 0.5);
      ctx.lineTo(w - 8, y + 0.5);
      ctx.stroke();
    }, [ch, fontA, fontB, overlayMode, dx, dy, letterSpacing, showChecker, stroke, strokeWidth]);

    return (
      <div className="flex flex-col items-center">
        <canvas ref={cellRef} className="rounded-lg shadow-sm border border-neutral-200" />
        <div className="text-xs text-neutral-600 mt-1">{ch === " " ? "space" : ch}</div>
      </div>
    );
  }

  // Метрики ширины строки
  const metrics = useMemo<{ wA: number; wB: number; diff: number } | null>(() => {
    if (!fontA || !fontB) return null;
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return null;
    const wA = measureString(c, fontA.name, text, letterSpacing);
    const wB = measureString(c, fontB.name, text, letterSpacing);
    return { wA, wB, diff: wB - wA };
  }, [fontA, fontB, text, letterSpacing, fontSize]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Font Overlay Comparator</h1>
          <div className="text-sm text-neutral-600">Чисто фронтенд • Drag&Drop поддерживается</div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        {!supported && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-4">
            Ваш браузер не поддерживает <code>FontFace</code>. Попробуйте актуальный Chrome/Firefox/Edge/Safari.
          </div>
        )}

        <section
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          className={`mb-4 rounded-2xl border-2 ${isDragging ? 'border-neutral-900 bg-neutral-50' : 'border-dashed border-neutral-300'} p-4`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-neutral-600">Перетащите сюда 1–2 файла шрифтов (.ttf/.otf/.woff/.woff2), или выберите вручную ниже</div>
            {isDragging && <div className="text-sm font-medium">Отпустите для загрузки</div>}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Шрифт A</div>
                {fontA && (
                  <button className="text-xs text-neutral-600 hover:text-neutral-900" onClick={() => reset('A')}>
                    Очистить
                  </button>
                )}
              </div>
              <FilePicker onChange={(e) => handleFilePick(e, 'A')} />
              {fontA && <div className="mt-2 text-sm text-neutral-700">{fontA.displayName}</div>}
            </Card>

            <Card>
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">Шрифт B</div>
                {fontB && (
                  <button className="text-xs text-neutral-600 hover:text-neutral-900" onClick={() => reset('B')}>
                    Очистить
                  </button>
                )}
              </div>
              <FilePicker onChange={(e) => handleFilePick(e, 'B')} />
              {fontB && <div className="mt-2 text-sm text-neutral-700">{fontB.displayName}</div>}
            </Card>
          </div>
        </section>

        <section
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="rounded-2xl border-2 border-dashed border-neutral-300 bg-white p-4 mb-4"
        >
          <div className="flex flex-col md:flex-row md:items-end gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1">Текст для сравнения</label>
              <textarea
                className="w-full rounded-xl border border-neutral-300 p-3 focus:outline-none focus:ring-2 focus:ring-neutral-800"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Введите текст"
              />
              <div className="text-xs text-neutral-500 mt-1">Поддерживается перетаскивание файлов шрифтов прямо сюда.</div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:w-[380px]">
              <div>
                <label className="block text-sm font-medium mb-1">Размер, px</label>
                <input
                  type="range"
                  min={16}
                  max={260}
                  value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="text-sm text-neutral-700 mt-1">{fontSize}px</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Трекинг, px</label>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={letterSpacing}
                  onChange={(e) => setLetterSpacing(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="text-sm text-neutral-700 mt-1">{letterSpacing}px</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Смещение B по X</label>
                <input type="range" min={-5} max={5} step={0.5} value={dx} onChange={(e) => setDx(parseFloat(e.target.value))} className="w-full" />
                <div className="text-sm text-neutral-700 mt-1">{dx}px</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Смещение B по Y</label>
                <input type="range" min={-5} max={5} step={0.5} value={dy} onChange={(e) => setDy(parseFloat(e.target.value))} className="w-full" />
                <div className="text-sm text-neutral-700 mt-1">{dy}px</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <div className="inline-flex items-center gap-2 bg-neutral-100 rounded-xl p-1">
              <Toggle active={overlayMode === "red-cyan"} onClick={() => setOverlayMode("red-cyan")}>
                Red/Cyan
              </Toggle>
              <Toggle active={overlayMode === "difference"} onClick={() => setOverlayMode("difference")}>
                Difference
              </Toggle>
            </div>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={stroke} onChange={(e) => setStroke(e.target.checked)} />
              <span className="text-sm">Обводка</span>
            </label>
            {stroke && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-600">Толщина:</span>
                <input type="number" min={1} max={6} value={strokeWidth} onChange={(e) => setStrokeWidth(parseInt(e.target.value || "1"))} className="w-16 rounded-lg border border-neutral-300 p-1" />
              </div>
            )}

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={showChecker} onChange={(e) => setShowChecker(e.target.checked)} />
              <span className="text-sm">Шахматный фон</span>
            </label>

            <button onClick={exportPNG} className="ml-auto px-3 py-2 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[.99]">
              Экспорт PNG
            </button>
          </div>

          <div className="mt-4">
            <canvas ref={canvasRef} className="w-full rounded-2xl shadow-sm border border-neutral-200" />
          </div>

          {metrics && (
            <div className="mt-3 text-sm text-neutral-700 grid sm:grid-cols-3 gap-2">
              <div className="bg-neutral-100 rounded-xl p-2">Ширина A: <b>{metrics.wA.toFixed(2)}px</b></div>
              <div className="bg-neutral-100 rounded-xl p-2">Ширина B: <b>{metrics.wB.toFixed(2)}px</b></div>
              <div className="bg-neutral-100 rounded-xl p-2">Разница (B - A): <b>{metrics.diff.toFixed(2)}px</b></div>
            </div>
          )}
        </section>

        <section className="mb-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Просмотр по символам</h2>
            <button
              className="px-3 py-2 rounded-xl border border-neutral-300 hover:bg-neutral-100"
              onClick={() => setGridOpen((v) => !v)}
            >
              {gridOpen ? "Скрыть" : "Показать"}
            </button>
          </div>

          {gridOpen && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-end gap-3 mb-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Набор символов</label>
                  <select
                    value={gridCharsPreset}
                    onChange={(e) => setGridCharsPreset(e.target.value as GridPreset)}
                    className="rounded-xl border border-neutral-300 p-2"
                  >
                    <option value="basic-latin">Basic Latin</option>
                    <option value="caps">A–Z</option>
                    <option value="lower">a–z</option>
                    <option value="digits">0–9</option>
                    <option value="punct">Пунктуация</option>
                    <option value="custom">Пользовательский</option>
                  </select>
                </div>
                {gridCharsPreset === "custom" && (
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-sm font-medium mb-1">Символы</label>
                    <input
                      value={customChars}
                      onChange={(e) => setCustomChars(e.target.value)}
                      className="w-full rounded-xl border border-neutral-300 p-2"
                      placeholder="Например: АВСабвё…"
                    />
                  </div>
                )}
              </div>

              {!fontA || !fontB ? (
                <div className="text-sm text-neutral-600">Загрузите оба шрифта, чтобы видеть наложение символов.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  {Array.from(gridChars).map((ch, i) => (
                    <GlyphCell ch={ch} key={`${ch}_${i}`} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h3 className="font-semibold mb-2">Подсказки</h3>
          <ul className="list-disc pl-5 text-sm text-neutral-700 space-y-1">
            <li>
              Различия между TTF и WOFF2 обычно связаны не с контурами, а с особенностями хинтинга/сглаживания и рендеринга.
              Для строгой геометрии можно включить режим <b>Difference</b>.
            </li>
            <li>
              Если нужна прецизионная проверка контуров глифов (outline), можно дополнительно парсить глифы (например, через OpenType.js) и рисовать их как пути на canvas — это возможно тоже на фронтенде.
            </li>
            <li>Экспорт PNG сохраняет текущий вид превью в исходном размере.</li>
            <li>Для тонкой подгонки используйте смещения B по осям (dx/dy).</li>
          </ul>
        </section>

        {messages.length > 0 && (
          <div className="fixed bottom-4 right-4 space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="bg-neutral-900 text-white text-sm px-3 py-2 rounded-xl shadow-lg">
                {m.msg}
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="text-center text-xs text-neutral-500 py-6">© {new Date().getFullYear()} Font Overlay Comparator — фронтенд only</footer>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="bg-white border border-neutral-200 rounded-2xl p-4 shadow-sm">{children}</div>;
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-lg text-sm transition " +
        (active ? "bg-neutral-900 text-white" : "bg-transparent text-neutral-800 hover:bg-neutral-200")
      }
    >
      {children}
    </button>
  );
}

function FilePicker({ onChange }: { onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="block border border-neutral-300 rounded-xl p-3 hover:bg-neutral-50 cursor-pointer">
      <div className="text-sm text-neutral-700">Выберите файл шрифта (.ttf, .otf, .woff, .woff2)</div>
      <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={onChange} />
    </label>
  );
}
