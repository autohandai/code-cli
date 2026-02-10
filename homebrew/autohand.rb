# Homebrew formula for autohand-cli
# To install: brew install autohand
# For tap usage: brew tap autohandai/tap && brew install autohand
class Autohand < Formula
  desc "Autonomous LLM-powered coding agent CLI"
  homepage "https://autohand.ai"
  url "https://registry.npmjs.org/autohand-cli/-/autohand-cli-0.7.11.tgz"
  sha256 "PLACEHOLDER"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/autohand --version")
  end
end
