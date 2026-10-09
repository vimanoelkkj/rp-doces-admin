<a id="offline-audit-fonts"></a>

# Fontes offline da auditoria

Estas fontes variáveis TrueType são fixtures de teste, não assets de produção. Elas reproduzem a tipografia Fraunces e Manrope da Home sem conexões externas. Os arquivos OFL que as acompanham contêm a licença SIL Open Font License completa e os avisos de copyright. Não os exclua ao distribuir as fixtures.

Baixadas do repositório oficial Google Fonts em 2026-10-09:

- `fraunces.ttf`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf
- `fraunces-italic.ttf`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf
- `fraunces-OFL.txt`: https://github.com/google/fonts/blob/4024282d9b0cffcdb8e3024560862746178d741f/ofl/fraunces/OFL.txt
- `manrope.ttf`: https://github.com/google/fonts/blob/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope/Manrope%5Bwght%5D.ttf
- `manrope-OFL.txt`: https://github.com/google/fonts/blob/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope/OFL.txt

Os arquivos binários exatos estão versionados, com cerca de 940 KB no total. A auditoria registra seus hashes SHA-256 em cada anexo de reprodução; a execução não os baixa nem atualiza. A Home não usa Inter, portanto essa família não está incluída. Revise a versão das fixtures e as screenshots ao atualizar intencionalmente essas fontes.

Os três binários foram verificados byte a byte contra essas referências fixas. O texto das licenças foi preservado; um espaço ao final de uma linha de cada licença foi removido para passar em `git diff --check`. Fraunces expõe `opsz` 9–144, `wght` 100–900, `SOFT` 0–100 (padrão 0) e `WONK` 0–1 (padrão 1); Manrope expõe `wght` 200–800. O CSS de auditoria declara essas faixas de peso. A Home usa Manrope 400–700 e Fraunces 600/700, além de itálico 600, com ajuste óptico padrão. As três faces precisam carregar efetivamente antes da captura.

Esses TTFs completos reproduzem as famílias/estilos/eixos solicitados, mas não são os subconjuntos WOFF2 específicos de navegador devolvidos pela folha de estilos real do Google. O serviço pode ser atualizado de forma independente; não há garantia de igualdade de pixels com uma resposta futura não especificada do Google Fonts.
