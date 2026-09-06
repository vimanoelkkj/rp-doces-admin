from pathlib import Path


def replace_once(path: str, before: str, after: str) -> None:
    file = Path(path)
    source = file.read_text(encoding="utf-8")
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{path}: esperava 1 ocorrência, encontrei {count}")
    file.write_text(source.replace(before, after), encoding="utf-8")


replace_once(
    "admin/src/products/ProductsPage.tsx",
    '''  useEffect(() => {
    if (!active || !focusProductIds.length) return;

    const ids = [...new Set(focusProductIds.filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return;

    setQuery("");
    setFilter("todos");
    setHighlightedIds(ids);
    onFocusConsumed?.();

    const scrollTimer = window.setTimeout(() => {
      const first = document.querySelector<HTMLElement>(`[data-product-id="${ids[0]}"]`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);

    const clearTimer = window.setTimeout(() => setHighlightedIds([]), 4_500);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [active, focusProductIds, onFocusConsumed]);''',
    '''  useEffect(() => {
    if (!active || !focusProductIds.length) return;

    const ids = [...new Set(focusProductIds.filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) return;

    setQuery("");
    setFilter("todos");
    setHighlightedIds(ids);

    const scrollTimer = window.setTimeout(() => {
      const first = document.querySelector<HTMLElement>(`[data-product-id="${ids[0]}"]`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocusConsumed?.();
    }, 120);

    return () => window.clearTimeout(scrollTimer);
  }, [active, focusProductIds, onFocusConsumed]);

  useEffect(() => {
    if (!highlightedIds.length) return;
    const clearTimer = window.setTimeout(() => setHighlightedIds([]), 4_500);
    return () => window.clearTimeout(clearTimer);
  }, [highlightedIds]);'''
)

replace_once(
    "apps/android/app/src/main/java/br/com/rpdoces/admin/ui/products/ProductsScreen.kt",
    '''    LaunchedEffect(focusProductIds, products) {
        if (focusProductIds.isEmpty() || products.isEmpty()) return@LaunchedEffect
        val ids = focusProductIds.filter { id -> products.any { it.id == id } }.toSet()
        if (ids.isEmpty()) {
            onFocusConsumed()
            return@LaunchedEffect
        }
        query = ""
        filter = ProductFilter.ALL
        highlightedIds = ids
        onFocusConsumed()
        val firstIndex = products.indexOfFirst { it.id in ids }
        if (firstIndex >= 0) gridState.animateScrollToItem(firstIndex)
        delay(4_500)
        highlightedIds = emptySet()
    }''',
    '''    LaunchedEffect(focusProductIds, products) {
        if (focusProductIds.isEmpty() || products.isEmpty()) return@LaunchedEffect
        val ids = focusProductIds.filter { id -> products.any { it.id == id } }.toSet()
        if (ids.isEmpty()) {
            onFocusConsumed()
            return@LaunchedEffect
        }
        query = ""
        filter = ProductFilter.ALL
        highlightedIds = ids
        val firstIndex = products.indexOfFirst { it.id in ids }
        if (firstIndex >= 0) gridState.scrollToItem(firstIndex)
        onFocusConsumed()
    }

    LaunchedEffect(highlightedIds) {
        if (highlightedIds.isEmpty()) return@LaunchedEffect
        delay(4_500)
        highlightedIds = emptySet()
    }'''
)

print("Ajuste final de foco aplicado.")
