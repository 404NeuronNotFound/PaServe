"""Prepare trusted-by-the-phone HTTPS for local camera testing; install no trust roots."""
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from pathlib import Path
import socket

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

root = Path(__file__).resolve().parent.parent
directory = root / ".local-https"
directory.mkdir(exist_ok=True)
addresses = sorted({entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
                    if ip_address(entry[4][0]).is_private and not ip_address(entry[4][0]).is_loopback})
now = datetime.now(timezone.utc)
reuse = False
if all((directory / name).exists() for name in ["server.pem", "server.key", "phone-ca.cer", "ca.pem"]):
    certificate = x509.load_pem_x509_certificate((directory / "server.pem").read_bytes())
    covered = certificate.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    reuse = (certificate.not_valid_after_utc > now + timedelta(days=7)
             and all(ip_address(address) in covered.get_values_for_type(x509.IPAddress) for address in addresses))
if not reuse:
    authority_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    authority_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PaServe Local Camera")])
    authority = (x509.CertificateBuilder().subject_name(authority_name).issuer_name(authority_name)
                 .public_key(authority_key.public_key()).serial_number(x509.random_serial_number())
                 .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=3650))
                 .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                 .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                     key_encipherment=False, data_encipherment=False, key_agreement=False,
                     key_cert_sign=True, crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
                 .add_extension(x509.SubjectKeyIdentifier.from_public_key(authority_key.public_key()), critical=False)
                 .sign(authority_key, hashes.SHA256()))
    server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server = (x509.CertificateBuilder()
              .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "PaServe local development")]))
              .issuer_name(authority_name).public_key(server_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
              .not_valid_after(now + timedelta(days=365))
              .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
              .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"),
                  *[x509.IPAddress(ip_address(value)) for value in ["127.0.0.1", *addresses]]]), critical=False)
              .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False,
                  key_encipherment=True, data_encipherment=False, key_agreement=False,
                  key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
              .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(authority_key.public_key()), critical=False)
              .sign(authority_key, hashes.SHA256()))
    (directory / "ca.pem").write_bytes(authority.public_bytes(serialization.Encoding.PEM))
    (directory / "phone-ca.cer").write_bytes(authority.public_bytes(serialization.Encoding.DER))
    (directory / "server.pem").write_bytes(server.public_bytes(serialization.Encoding.PEM))
    (directory / "server.key").write_bytes(server_key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    # The CA signing key is deliberately not saved. Only this computer's leaf key remains.
    print("Created local certificates. Install/trust PaServe Local Camera on the phone.")
else:
    print("Reusing existing local certificates.")

def update_env(path, values):
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    for key, value in values.items():
        lines = [line for line in lines if not line.startswith(key + "=")]
        lines.append(key + "=" + value)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

update_env(root / "apps/web/.env.camera.local", {
    "VITE_API_URL": "/api/v1", "VITE_PUBLIC_APP_URL": "",
    "VITE_CSP_CONNECT_ORIGINS": ",".join("wss://" + host + ":5443" for host in ["localhost", *addresses]),
})
api_env = root / "apps/api/.env"
lines = api_env.read_text(encoding="utf-8").splitlines()
current = next((line.split("=", 1)[1].strip().strip("\"'") for line in lines if line.startswith("FRONTEND_ORIGINS=")), "http://localhost:5173")
origins = [entry.strip() for entry in current.split(",") if entry.strip()]
for host in ["localhost", *addresses]:
    origin = "https://" + host + ":5443"
    if origin not in origins:
        origins.append(origin)
update_env(api_env, {"FRONTEND_ORIGINS": ",".join(origins)})
print("Restart the API once to load the added HTTPS origins.")
for address in addresses:
    print("Certificate download: http://" + address + ":5173/local-camera-ca.cer")
    print("Camera test site: https://" + address + ":5443")
