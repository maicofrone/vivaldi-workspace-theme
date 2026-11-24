#!/usr/bin/env bash
# Instala o Vivaldi Workspace Theme (troca de tema por workspace).
# Rode como usuário normal; pede sudo só para tocar em /opt/vivaldi e no hook do pacman.
set -euo pipefail

ORIGEM="$(cd "$(dirname "$0")" && pwd)"
DESTINO="$HOME/.local/share/vivaldi-mods"
VIV_RES="/opt/vivaldi/resources/vivaldi"

mkdir -p "$DESTINO"
cp "$ORIGEM/workspace-theme.js" "$DESTINO/"
echo "Arquivos copiados para $DESTINO"

# Script que aplica o JS no window.html (reaproveitado pelo hook após updates).
sudo tee /usr/local/bin/vivaldi-mod-patch >/dev/null <<EOF
#!/usr/bin/env bash
set -e
RES="$VIV_RES"
cp "$DESTINO/workspace-theme.js" "\$RES/workspace-theme.js"
grep -q 'workspace-theme.js' "\$RES/window.html" || \
  sed -i 's#</body>#  <script src="workspace-theme.js"></script>\n</body>#' "\$RES/window.html"
echo "vivaldi-mod-patch: aplicado em \$RES/window.html"
EOF
sudo chmod 755 /usr/local/bin/vivaldi-mod-patch

# Hook do pacman: o update do Vivaldi apaga o patch; isto reaplica sozinho.
sudo mkdir -p /etc/pacman.d/hooks
sudo tee /etc/pacman.d/hooks/vivaldi-mods.hook >/dev/null <<'EOF'
[Trigger]
Operation = Install
Operation = Upgrade
Type = Package
Target = vivaldi
Target = vivaldi-snapshot

[Action]
Description = Reaplicando mods do Vivaldi (tema por workspace)...
When = PostTransaction
Exec = /usr/local/bin/vivaldi-mod-patch
EOF

sudo /usr/local/bin/vivaldi-mod-patch
echo
echo "Pronto. Feche e abra o Vivaldi e veja Configurações → Temas."
