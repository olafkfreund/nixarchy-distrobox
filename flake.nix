{
  description = "nixarchy.distrobox -- distrobox in the Omarchy shell: a bar widget and a full-screen keyboard menu";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = nixpkgs.lib.genAttrs systems;

      manifest = builtins.fromJSON (builtins.readFile ./manifest.json);

      # Exactly what the shell loads. The artifacts, tests and docs are for
      # whoever reads the repository, not for the plugin folder.
      files = [
        ./manifest.json
        ./qmldir
        ./LICENSE
        ./Model.js
        ./Panel.qml
        ./Menu.qml
        ./DistroboxState.qml
        ./DistroboxView.qml
        ./BoxList.qml
        ./CreateForm.qml
        ./LogView.qml
        ./ShortcutSheet.qml
      ];

      pluginFor = pkgs:
        # runCommand and plain copies, deliberately: omarchy-plugin-validate
        # refuses any symlink inside a plugin folder, so symlinkJoin or a
        # linkFarm would fail validation at rebuild time.
        pkgs.runCommand "nixarchy-distrobox-${manifest.version}"
          {
            meta = with pkgs.lib; {
              description = "Omarchy plugin: create, enter, start, stop, upgrade and delete distrobox containers from the bar and a key";
              homepage = "https://github.com/olafkfreund/nixarchy-distrobox";
              license = licenses.mit;
              platforms = platforms.linux;
            };
          }
          ''
            mkdir -p "$out"
            ${nixpkgs.lib.concatMapStringsSep "\n" (f: ''cp ${f} "$out/${baseNameOf f}"'') files}
          '';
    in
    {
      packages = forAll (system:
        let pkgs = nixpkgs.legacyPackages.${system};
        in rec {
          default = nixarchy-distrobox;
          nixarchy-distrobox = pluginFor pkgs;
        });

      checks = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          plugin = self.packages.${system}.default;
        in
        {
          default = pkgs.runCommand "nixarchy-distrobox-check"
            { nativeBuildInputs = [ pkgs.nodejs pkgs.jq ]; }
            ''
              # Model.js carries all the logic, and runs under plain Node.
              cp -r ${./tests} tests
              cp ${./Model.js} Model.js
              node tests/run.js

              # The manifest is what the shell validates at load: a typo in it
              # is a plugin that silently never appears.
              jq -e '
                .schemaVersion == 1
                and .id == "nixarchy.distrobox"
                and .keepLoaded == true
                and (.kinds | index("menu") and index("bar-widget"))
                and .entryPoints.menu == "Menu.qml"
                and .entryPoints.barWidget == "Panel.qml"
              ' ${plugin}/manifest.json > /dev/null
              for f in $(jq -r '.entryPoints[]' ${plugin}/manifest.json); do
                test -f "${plugin}/$f" || { echo "entry point $f missing from the package" >&2; exit 1; }
              done

              # Without this line the bar and the menu each get their own
              # state, and "one mutation at a time" silently stops holding.
              grep -qx 'singleton DistroboxState 1.0 DistroboxState.qml' ${plugin}/qmldir \
                || { echo "qmldir does not declare the DistroboxState singleton" >&2; exit 1; }

              # omarchy-plugin-validate refuses symlinks inside a plugin. Both
              # places count: the package, and the repository itself, which
              # `omarchy plugin add` clones as the plugin folder. A symlink in
              # the repo never reaches the package (cp follows it), so the
              # package check alone would miss it.
              if [ -n "$(find ${plugin} -mindepth 1 -type l)" ]; then
                echo "symlink inside the package" >&2; exit 1
              fi
              if [ -n "$(find ${self} -mindepth 1 -type l)" ]; then
                find ${self} -mindepth 1 -type l >&2
                echo "symlink in the repository above" >&2; exit 1
              fi

              # nixarchy's own plugin validation fails the rebuild on these.
              if grep -nwE 'pacman|yay' ${plugin}/*.qml ${plugin}/*.js; then
                echo "Arch package manager reference above" >&2; exit 1
              fi

              # A literal colour survives a theme switch and looks wrong.
              if grep -nE '"#[0-9a-fA-F]{3,8}"' ${plugin}/*.qml; then
                echo "hardcoded colour above; use a Color.* token" >&2; exit 1
              fi

              touch "$out"
            '';
        });
    };
}
