#!/usr/bin/env bash

set -Eeuo pipefail

SOURCE_REF="origin/feat/new-storefront-modular"
BASE_REF="origin/main"

TARGET_BRANCH="rewrite/storefront-formatada"
BACKUP_BRANCH="backup/storefront-original-$(date +%Y%m%d-%H%M%S)"

fail() {
  echo
  echo "ERRO: $1"
  exit 1
}

echo
echo "============================================================"
echo " R&P DOCES - RECONSTRUCAO FORMATADA"
echo "============================================================"
echo

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "Execute dentro do repositorio."

git remote get-url origin >/dev/null 2>&1 \
  || fail "Remote origin nao existe."

if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "Working tree possui alteracoes."
fi

echo "==> Atualizando origin..."
git fetch origin

git rev-parse "$SOURCE_REF" >/dev/null 2>&1 \
  || fail "$SOURCE_REF nao existe."

git rev-parse "$BASE_REF" >/dev/null 2>&1 \
  || fail "$BASE_REF nao existe."

echo "==> Verificando Prettier..."
npx prettier --version

BASE="$(git merge-base "$BASE_REF" "$SOURCE_REF")"

echo
echo "Merge-base:"
git show -s --oneline "$BASE"

# Não reconstruímos merges automaticamente.
MERGES="$(git rev-list --merges "$BASE..$SOURCE_REF")"

if [ -n "$MERGES" ]; then
  echo "$MERGES"
  fail "Existem merge commits no intervalo."
fi

mapfile -t COMMITS < <(
  git rev-list --reverse "$BASE..$SOURCE_REF"
)

TOTAL="${#COMMITS[@]}"

[ "$TOTAL" -gt 0 ] \
  || fail "Nenhum commit encontrado."

echo
echo "Commits encontrados: $TOTAL"

git branch "$BACKUP_BRANCH" "$SOURCE_REF"

echo "Backup:"
echo "  $BACKUP_BRANCH"

if git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
  fail "$TARGET_BRANCH ja existe."
fi

git switch -c "$TARGET_BRANCH" "$BASE"

CURRENT=0

for COMMIT in "${COMMITS[@]}"; do

  CURRENT=$((CURRENT + 1))

  SUBJECT="$(git show -s --format='%s' "$COMMIT")"
  PARENT="$(git rev-parse "$COMMIT^")"

  echo
  echo "============================================================"
  echo " [$CURRENT/$TOTAL]"
  echo " $SUBJECT"
  echo " $COMMIT"
  echo "============================================================"

  FORMAT_FILES=()

  # --------------------------------------------
  # Reproduzir arquivos modificados pelo commit
  # --------------------------------------------

  while IFS=$'\t' read -r STATUS PATH1 PATH2; do

    [ -z "$STATUS" ] && continue

    case "$STATUS" in

      A*|M*|T*)
        echo "Aplicando: $PATH1"

        git checkout "$COMMIT" -- "$PATH1"

        FORMAT_FILES+=("$PATH1")
        ;;

      D*)
        echo "Removendo: $PATH1"

        git rm -f --ignore-unmatch -- "$PATH1"
        ;;

      R*)
        echo "Renomeando: $PATH1 -> $PATH2"

        git rm -f --ignore-unmatch -- "$PATH1"

        git checkout "$COMMIT" -- "$PATH2"

        FORMAT_FILES+=("$PATH2")
        ;;

      C*)
        echo "Copiando: $PATH2"

        git checkout "$COMMIT" -- "$PATH2"

        FORMAT_FILES+=("$PATH2")
        ;;

      *)
        echo "STATUS NAO TRATADO: $STATUS $PATH1 $PATH2"
        exit 30
        ;;

    esac

  done < <(
    git diff-tree \
      -r \
      -M \
      -C \
      --name-status \
      "$PARENT" \
      "$COMMIT"
  )

  # --------------------------------------------
  # Selecionar arquivos para Prettier
  # --------------------------------------------

  PRETTIER_FILES=()

  for FILE in "${FORMAT_FILES[@]}"; do

    [ -f "$FILE" ] || continue

    case "$FILE" in

      public/assets/js/assets/temponi-logo-full.js)
        echo "Ignorando data URI: $FILE"
        continue
        ;;

      *.min.js|*.min.css)
        echo "Ignorando minificado: $FILE"
        continue
        ;;

    esac

    if [[ "$FILE" =~ \.(js|css|html|json|md)$ ]]; then
      PRETTIER_FILES+=("$FILE")
    fi

  done

  # --------------------------------------------
  # Formatar arquivos do commit
  # --------------------------------------------

  if [ "${#PRETTIER_FILES[@]}" -gt 0 ]; then

    echo
    echo "Prettier:"
    printf '  %s\n' "${PRETTIER_FILES[@]}"

    npx prettier \
      --write \
      --ignore-unknown \
      "${PRETTIER_FILES[@]}"

  fi

  # --------------------------------------------
  # Stage
  # --------------------------------------------

  git add -A

  # --------------------------------------------
  # Recriar commit
  #
  # -C preserva mensagem + autoria.
  # Também preservamos a data do committer original.
  # --------------------------------------------

  COMMITTER_DATE="$(git show -s --format='%cI' "$COMMIT")"

  GIT_COMMITTER_DATE="$COMMITTER_DATE" \
    git commit \
      --allow-empty \
      --no-verify \
      -C "$COMMIT"

done

echo
echo "============================================================"
echo " RECONSTRUCAO TERMINADA"
echo "============================================================"
echo
echo "Original:"
echo "  $SOURCE_REF"
echo
echo "Backup:"
echo "  $BACKUP_BRANCH"
echo
echo "Reconstruida:"
echo "  $TARGET_BRANCH"
echo
echo "Commits originais:"
git rev-list --count "$BASE..$SOURCE_REF"

echo
echo "Commits reconstruidos:"
git rev-list --count "$BASE..$TARGET_BRANCH"

echo
echo "NAO FOI FEITO PUSH."
echo "NAO FOI FEITO FORCE PUSH."
echo
echo "Agora precisamos validar o resultado antes de substituir a branch."